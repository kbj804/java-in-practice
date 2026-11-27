package kr.aloui.community.message

import org.springframework.stereotype.Component
import java.time.Duration
import java.util.concurrent.CopyOnWriteArrayList

/** 브로커로 보내는 메시지. eventId 는 받는 쪽이 같은 메시지를 두 번 처리하지 않게 거르는 키다. */
data class Message(
    val eventId: String,
    val type: String,
    val payload: String,
)

class BrokerUnavailableException : RuntimeException("message broker unavailable")

/**
 * 메시지 브로커 대역. 받은 메시지를 메모리에 쌓기만 한다.
 * 실험에서 down 을 켜면 브로커 장애처럼 publish 가 예외를 던진다.
 * 다음 단계에서 RabbitMQ 로 바꾼다.
 */
@Component
class MessageBroker {
    @Volatile
    var down: Boolean = false

    /** 한 건 보낼 때 걸리는 시간. 릴레이 두 개가 겹치는 실험에서만 늘린다. */
    @Volatile
    var latency: Duration = Duration.ZERO

    val received: MutableList<Message> = CopyOnWriteArrayList()

    fun publish(message: Message) {
        if (down) throw BrokerUnavailableException()
        if (!latency.isZero) Thread.sleep(latency)
        received += message
    }
}
