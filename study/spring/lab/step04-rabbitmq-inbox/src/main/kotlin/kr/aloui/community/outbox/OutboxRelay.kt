package kr.aloui.community.outbox

import kr.aloui.community.message.Message
import kr.aloui.community.message.EventPublisher
import org.slf4j.LoggerFactory
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.data.domain.Limit
import org.springframework.scheduling.annotation.EnableScheduling
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional
import java.time.Clock

/** outbox 표에서 아직 안 보낸 행을 읽어 RabbitMQ 로 보내고, 브로커가 받았다고 확인한 행에 published_at 을 찍는다. */
@Component
class OutboxRelay(
    private val repository: OutboxEventRepository,
    private val publisher: EventPublisher,
    private val clock: Clock,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    /**
     * 한 번 훑는다. 보낸 건수를 돌려준다.
     *
     * 잠근 행을 보내는 동안 트랜잭션(=커넥션)을 쥐고 있다. 실험 ①에서 본 것처럼 외부 호출을 트랜잭션 안에 두는 셈이라
     * 한 번에 잡는 개수(batchSize)를 작게 두고, 브로커 호출에는 짧은 타임아웃을 둬야 한다.
     */
    @Transactional
    fun relayOnce(batchSize: Int = 100): Int {
        var sent = 0
        for (event in repository.lockUnpublished(Limit.of(batchSize))) {
            try {
                publisher.publish(Message(event.eventId.toString(), event.eventType, event.payload))
            } catch (e: Exception) {
                // 실패한 행은 그대로 두고 다음 주기에 다시 보낸다. 이미 보낸 행의 표시는 커밋한다.
                event.attempts += 1
                event.lastError = e.message?.take(500)
                log.warn("outbox {} 보내기 실패 ({}회째): {}", event.id, event.attempts, e.message)
                break
            }
            event.publishedAt = clock.instant()
            sent++
        }
        return sent
    }
}

@Component
@EnableScheduling
@ConditionalOnProperty("outbox.relay.enabled", havingValue = "true", matchIfMissing = true)
class OutboxRelayScheduler(private val relay: OutboxRelay) {
    @Scheduled(fixedDelayString = "\${outbox.relay.interval:PT1S}")
    fun run() {
        relay.relayOnce()
    }
}
