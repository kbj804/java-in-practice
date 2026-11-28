package kr.aloui.community.notification

import kr.aloui.community.TestClock
import kr.aloui.community.TestcontainersConfiguration
import kr.aloui.community.message.NOTIFICATION_QUEUE
import kr.aloui.community.outbox.OutboxRelay
import kr.aloui.community.post.POST_CREATED
import kr.aloui.community.post.PostCreatedPayload
import kr.aloui.community.post.PostService
import org.assertj.core.api.Assertions.assertThat
import org.awaitility.kotlin.atMost
import org.awaitility.kotlin.await
import org.awaitility.kotlin.until
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.amqp.core.MessageBuilder
import org.springframework.amqp.core.MessageProperties
import org.springframework.amqp.rabbit.core.RabbitTemplate
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.simple.JdbcClient
import tools.jackson.databind.json.JsonMapper
import java.time.Duration
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

/**
 * 실험 ③. 같은 동네 이웃 1,000명에게 "새 글" 알림을 보내는 워커.
 * outbox 는 적어도 한 번 보내므로 같은 메시지가 두 번 올 수 있고, 워커는 보내다 죽을 수 있다.
 * 결과는 "[실험③]" 으로 시작하는 줄로 출력한다.
 *
 * 스케줄러(릴레이, NotificationSweeper)는 끄고, 테스트가 정한 시점에 직접 돌린다.
 */
@SpringBootTest(properties = ["outbox.relay.enabled=false", "notification.sweeper.enabled=false"])
@Import(TestcontainersConfiguration::class)
class NotificationInboxExperimentTest(
    @Autowired private val rabbit: RabbitTemplate,
    @Autowired private val jdbc: JdbcClient,
    @Autowired private val jsonMapper: JsonMapper,
    @Autowired private val push: FakePushSender,
    @Autowired private val clock: TestClock,
    @Autowired private val deliveries: NotificationDeliveryRepository,
    @Autowired private val dispatcher: NotificationDispatcher,
    @Autowired private val inbox: PostCreatedNotificationListener,
    @Autowired private val naive: NaiveNotificationListener,
    @Autowired private val lateAck: LateAckNotificationListener,
    @Autowired private val postService: PostService,
    @Autowired private val relay: OutboxRelay,
) {
    private val members = 1_000

    @BeforeEach
    fun reset() {
        push.reset()
        clock.reset()
        jdbc.sql("delete from notification_delivery").update()
    }

    @AfterEach
    fun resetClock() = clock.reset() // 같은 Spring 컨텍스트를 쓰는 다른 테스트가 고정 시각을 기대한다

    @Test
    fun `글 하나가 outbox 와 RabbitMQ 를 거쳐 이웃 1000명에게 한 번씩 알림으로 간다`() {
        val region = seedRegion()
        val before = inbox.handled.get()

        postService.create(authorId = 1, regionId = region, content = "동네 붕어빵 트럭 왔어요")
        relay.relayOnce() // outbox → RabbitMQ (publisher confirm 까지)

        await atMost WAIT until { inbox.handled.get() == before + 1 }
        val result = outcome()
        report("글쓰기 → outbox → RabbitMQ → inbox", result)
        assertThat(result.reached).isEqualTo(members)
        assertThat(result.duplicatePushes).isZero()
    }

    @Test
    fun `가 - inbox 없이 받자마자 보내면 같은 메시지 두 번에 이웃 모두가 알림을 두 번 받는다`() {
        val region = seedRegion()
        val eventId = UUID.randomUUID()
        val before = naive.handled.get()

        repeat(2) { publish(EXPERIMENT_NAIVE_QUEUE, eventId, region) }
        await atMost WAIT until { naive.handled.get() == before + 2 }

        val result = outcome()
        report("가 inbox 없음 · 같은 메시지 2번", result)
        assertThat(result.duplicatePushes).isEqualTo(members)
        assertThat(result.trayDuplicates).isEqualTo(members) // tag 도 없어서 알림창에 두 개씩 뜬다
    }

    @Test
    fun `다 - inbox 는 같은 메시지가 두 번 와도 한 번만 보낸다`() {
        val region = seedRegion()
        val eventId = UUID.randomUUID()
        val before = inbox.handled.get()

        publish(NOTIFICATION_QUEUE, eventId, region)
        await atMost WAIT until { inbox.handled.get() == before + 1 }
        publish(NOTIFICATION_QUEUE, eventId, region) // 릴레이가 published_at 을 찍기 전에 죽어서 다시 보낸 메시지
        await atMost WAIT until { inbox.handled.get() == before + 2 }

        val result = outcome()
        report("다 inbox · 같은 메시지 2번 (차례로)", result)
        assertThat(result.pushes).isEqualTo(members)
        assertThat(result.duplicatePushes).isZero()
    }

    @Test
    fun `다 - 두 워커가 같은 메시지를 동시에 받아도 유니크 키와 SKIP LOCKED 로 나눠 보내고 겹치지 않는다`() {
        val region = seedRegion()
        val eventId = UUID.randomUUID()
        val before = inbox.handled.get()
        push.latency = Duration.ofMillis(2) // 1,000건 = 2초. 두 워커가 겹치게 만든다

        repeat(2) { publish(NOTIFICATION_QUEUE, eventId, region) }
        await atMost WAIT until { inbox.handled.get() == before + 2 }

        val result = outcome()
        val byThread = push.sent.groupingBy { it.thread }.eachCount()
        report("다 inbox · 같은 메시지 2번 (동시에)", result, "워커별 ${byThread.values.sortedDescending()}")
        assertThat(result.pushes).isEqualTo(members)
        assertThat(result.duplicatePushes).isZero()
        assertThat(byThread).hasSize(2) // 두 워커가 실제로 함께 보냈다
    }

    @Test
    fun `나 - 다 보낸 뒤에 ack 하고 스케줄러가 없으면, 너무 일찍 다시 온 메시지가 리스 중인 행을 못 가져가 유실된다`() {
        val region = seedRegion()
        val eventId = UUID.randomUUID()
        val before = lateAck.handled.get()
        push.crashAfter(350) // 300명(3묶음) 끝내고, 4번째 묶음 100명 중 50명 보낸 뒤 죽는다

        publish(EXPERIMENT_LATE_ACK_QUEUE, eventId, region)
        // 죽음 → 메시지가 바로 다시 옴 → 남은 pending 600명은 보냄 → ack
        await atMost WAIT until { lateAck.handled.get() == before + 2 }
        val afterRedelivery = states(eventId)

        clock.advance(Duration.ofSeconds(31)) // 리스가 지나도 다시 가져갈 계기가 없다
        Thread.sleep(500)

        val result = outcome()
        report("나 늦은 ack · 스케줄러 없음 · 보내다 죽음", result, "재전달 뒤 행 $afterRedelivery")
        assertThat(afterRedelivery).isEqualTo(States(pending = 0, processing = 100, completed = 900))
        assertThat(result.missed).isEqualTo(50)
    }

    @Test
    fun `다 - 행 만든 직후 ack 하고 스케줄러가 돌면, 보내다 죽어도 리스가 지난 뒤 모두 보낸다`() {
        val region = seedRegion()
        val eventId = UUID.randomUUID()
        val before = inbox.handled.get()
        push.crashAfter(350)

        publish(NOTIFICATION_QUEUE, eventId, region)
        await atMost WAIT until { inbox.handled.get() == before + 1 }
        val afterCrash = states(eventId) // ack 는 이미 갔으니 메시지는 다시 오지 않는다

        val first = dispatcher.dispatch() // 스케줄러 1회: pending 만 가져간다. processing 은 아직 리스 중
        val afterFirst = states(eventId)

        clock.advance(Duration.ofSeconds(31))
        val second = dispatcher.dispatch() // 스케줄러 1회: 리스가 지난 processing 을 가져간다

        val result = outcome()
        report(
            "다 inbox · 이른 ack + 스케줄러 · 보내다 죽음",
            result,
            "죽은 직후 행 $afterCrash → 스케줄러 ${first}건 → 행 $afterFirst → 31초 뒤 스케줄러 ${second}건",
        )
        assertThat(afterCrash).isEqualTo(States(pending = 600, processing = 100, completed = 300))
        assertThat(result.missed).isZero()
        assertThat(result.duplicatePushes).isEqualTo(50) // 죽기 전에 보냈지만 completed 로 못 바꾼 50명
        assertThat(result.trayDuplicates).isZero() // tag = event_id 라 알림창에는 하나만 남는다
    }

    // ---- 도구 ----

    data class States(val pending: Long, val processing: Long, val completed: Long) {
        override fun toString() = "pending $pending · processing $processing · completed $completed"
    }

    /**
     * pushes 보낸 푸시, reached 한 번이라도 받은 이웃, missed 못 받은 이웃,
     * duplicatePushes 같은 사람에게 두 번 이상 간 푸시, trayDuplicates 알림창에 겹쳐 뜬 알림(tag 가 같으면 덮어씀)
     */
    data class Outcome(val pushes: Int, val reached: Int, val missed: Int, val duplicatePushes: Int, val trayDuplicates: Int)

    private fun outcome(): Outcome {
        val sent = push.sent.toList()
        val reached = sent.map { it.userId }.toSet().size
        val tray = sent.withIndex().map { (i, p) -> p.userId to (p.tag ?: "no-tag-$i") }.toSet().size
        return Outcome(sent.size, reached, members - reached, sent.size - reached, tray - reached)
    }

    private fun states(eventId: UUID) = States(
        pending = deliveries.countByEventIdAndState(eventId, "pending"),
        processing = deliveries.countByEventIdAndState(eventId, "processing"),
        completed = deliveries.countByEventIdAndState(eventId, "completed"),
    )

    private fun report(label: String, o: Outcome, extra: String = "") = println(
        "[실험③] $label: 이웃 $members, 푸시 ${o.pushes}, 받은 이웃 ${o.reached}, 못 받은 이웃 ${o.missed}, " +
            "중복 푸시 ${o.duplicatePushes}, 알림창 중복 ${o.trayDuplicates}" + (if (extra.isEmpty()) "" else " | $extra"),
    )

    private fun seedRegion(): Long {
        val region = nextRegion.incrementAndGet()
        jdbc.sql("insert into region_member (region_id, user_id) select :region, g from generate_series(1, :n) g")
            .param("region", region).param("n", members).update()
        return region
    }

    /** outbox 릴레이가 보내는 것과 같은 모양의 메시지를 큐에 직접 넣는다. */
    private fun publish(queue: String, eventId: UUID, region: Long) {
        val body = jsonMapper.writeValueAsString(PostCreatedPayload(postId = 1, regionId = region))
        val message = MessageBuilder.withBody(body.toByteArray())
            .setMessageId(eventId.toString())
            .setType(POST_CREATED)
            .setContentType(MessageProperties.CONTENT_TYPE_JSON)
            .build()
        rabbit.send("", queue, message) // 기본 exchange: 라우팅 키 = 큐 이름
    }

    companion object {
        private val WAIT: Duration = Duration.ofSeconds(30)

        // JUnit 은 테스트 메서드마다 인스턴스를 새로 만든다. 동네 번호는 클래스 단위로 센다.
        private val nextRegion = AtomicLong(20_000)
    }
}
