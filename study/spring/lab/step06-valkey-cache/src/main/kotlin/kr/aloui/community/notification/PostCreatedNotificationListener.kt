package kr.aloui.community.notification

import com.rabbitmq.client.Channel
import kr.aloui.community.message.NOTIFICATION_QUEUE
import kr.aloui.community.post.PostCreatedPayload
import org.slf4j.LoggerFactory
import org.springframework.amqp.rabbit.annotation.RabbitListener
import org.springframework.stereotype.Component
import tools.jackson.databind.json.JsonMapper
import java.time.Clock
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import org.springframework.amqp.core.Message as AmqpMessage

/** RabbitMQ 메시지에서 inbox 에 적을 값을 꺼낸다. */
data class IncomingPostCreated(val eventId: UUID, val payload: PostCreatedPayload)

fun AmqpMessage.toPostCreated(jsonMapper: JsonMapper) = IncomingPostCreated(
    eventId = UUID.fromString(messageProperties.messageId),
    payload = jsonMapper.readValue(body, PostCreatedPayload::class.java),
)

/**
 * 알림 워커. 설계 ①~⑤ 중 ①② 와 ack 를 맡고, ③④⑤ 는 NotificationDispatcher 에 넘긴다.
 *
 * ackMode = MANUAL: ack 를 언제 보낼지 코드에서 정한다. (기본 AUTO 는 리스너 메서드가 정상으로 끝난 뒤 ack 한다.)
 * concurrency = 2: 컨슈머 스레드 두 개. 같은 메시지 두 개를 동시에 받는 실험에 쓴다.
 * prefetch 는 application.yaml 에서 1 로 둔다. 컨슈머 하나가 ack 안 된 메시지를 하나까지만 받는다.
 */
@Component
class PostCreatedNotificationListener(
    private val deliveries: NotificationDeliveryRepository,
    private val dispatcher: NotificationDispatcher,
    private val jsonMapper: JsonMapper,
    private val clock: Clock,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    /** 처리를 마친 메시지 수. 테스트가 "두 번째 메시지까지 다 처리했나"를 기다리는 데 쓴다. */
    val handled = AtomicInteger()

    @RabbitListener(queues = [NOTIFICATION_QUEUE], ackMode = "MANUAL", concurrency = "2")
    fun onMessage(message: AmqpMessage, channel: Channel) {
        val deliveryTag = message.messageProperties.deliveryTag
        val incoming = message.toPostCreated(jsonMapper)

        // ② 행 만들기. 이 메서드가 돌아오면 커밋까지 끝난 것이다.
        val created = deliveries.acceptForRegion(incoming.eventId, incoming.payload.postId, incoming.payload.regionId, clock.instant())

        // ② 의 커밋 뒤에 ack. 이제 이 메시지가 해야 할 일은 모두 DB 행으로 남았다.
        // 커밋 전에 ack 하고 죽으면 행도 메시지도 없다 (step03 의 AFTER_COMMIT 유실과 같은 틈).
        channel.basicAck(deliveryTag, false)
        log.info("event {}: 새 행 {}개, ack", incoming.eventId, created)

        // ③④⑤ 바로 한 번 보낸다. 여기서 죽어도 남은 행은 NotificationSweeper 가 보낸다.
        try {
            dispatcher.dispatch()
        } catch (t: Throwable) {
            log.warn("event {}: 보내다 멈춤 ({}). 남은 행은 스케줄러가 보낸다", incoming.eventId, t.message)
        } finally {
            handled.incrementAndGet()
        }
    }
}
