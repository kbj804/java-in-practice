package kr.aloui.community.notification

import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.scheduling.annotation.EnableScheduling
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Duration

/**
 * ③ 가져가기 → ④ 보내기 → ⑤ 끝내기 를 가져갈 행이 없을 때까지 반복한다.
 *
 * 이 메서드에는 @Transactional 이 없다. ③과 ⑤는 리포지토리 메서드마다 짧은 트랜잭션으로 끝나고,
 * ④ 푸시를 보내는 동안에는 DB 커넥션을 쥐고 있지 않다 (step02 의 커넥션 풀 고갈을 피한다).
 */
@Component
class NotificationDispatcher(
    private val deliveries: NotificationDeliveryRepository,
    private val push: PushSender,
    private val clock: Clock,
    @Value("\${notification.lease:PT30S}") private val lease: Duration,
    @Value("\${notification.batch-size:100}") private val batchSize: Int,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    /** 보낸 건수를 돌려준다. */
    fun dispatch(): Int {
        var sent = 0
        while (true) {
            val now = clock.instant()
            val mine = deliveries.claim(now, now.minus(lease), batchSize) // ③ 커밋까지 끝남
            if (mine.isEmpty()) return sent

            val done = mutableListOf<Long>()
            for (d in mine) {
                try {
                    push.send(d.userId, "동네에 새 글이 올라왔어요 (#${d.postId})", tag = d.eventId.toString()) // ④
                    done += d.id
                } catch (e: Exception) {
                    // 이 사람 것만 processing 으로 남겨 둔다. 리스가 지나면 다음 가져가기에서 다시 보낸다.
                    log.warn("알림 {} 보내기 실패: {}", d.id, e.message)
                }
            }
            if (done.isNotEmpty()) deliveries.complete(done, clock.instant()) // ⑤
            sent += done.size
        }
    }
}

/**
 * 주기적으로 돌아보며 남은 행을 보낸다. RabbitMQ 메시지는 ② 직후 ack 하므로, 그 뒤에 서버가 죽으면 메시지는 다시 오지 않는다.
 * 그때 pending 이나 리스가 지난 processing 행을 보내 주는 것이 이 스케줄러다.
 */
@Component
@EnableScheduling
@ConditionalOnProperty("notification.sweeper.enabled", havingValue = "true", matchIfMissing = true)
class NotificationSweeper(private val dispatcher: NotificationDispatcher) {
    @Scheduled(fixedDelayString = "\${notification.sweeper.interval:PT5S}")
    fun run() {
        dispatcher.dispatch()
    }
}
