package kr.aloui.community.notification

import org.springframework.stereotype.Component
import java.time.Duration
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

/**
 * 휴대폰으로 푸시를 보내는 쪽 (FCM 같은 외부 서비스).
 * tag 가 같은 알림이 오면 휴대폰 OS 가 알림창의 앞 알림을 덮어쓴다 (Android 의 notification.tag, iOS 의 apns-collapse-id).
 * FCM 자체는 같은 요청을 거르지 않는다. 두 번 보내면 두 번 도착한다.
 */
interface PushSender {
    fun send(userId: Long, title: String, tag: String?)
}

data class Push(val userId: Long, val title: String, val tag: String?, val thread: String)

/**
 * 서버가 그 자리에서 죽은 것을 흉내 낸다.
 * Exception 이 아니라 Error 라서 `catch (e: Exception)` 에 잡히지 않고, 정리 코드(completed 로 바꾸기)도 돌지 않는다.
 */
class SimulatedCrash : Error("server crashed (simulated)")

/** FCM 대역. 보낸 푸시를 메모리에 쌓는다. 실험에서 latency 와 crashAfter 를 바꾼다. */
@Component
class FakePushSender : PushSender {
    val sent: MutableList<Push> = CopyOnWriteArrayList()

    /** 한 건 보내는 데 걸리는 시간 (FCM 응답까지). */
    @Volatile
    var latency: Duration = Duration.ZERO

    private val untilCrash = AtomicInteger(Int.MAX_VALUE)

    /** 앞으로 n 건을 보낸 뒤 한 번 죽는다. */
    fun crashAfter(n: Int) = untilCrash.set(n)

    fun reset() {
        sent.clear()
        latency = Duration.ZERO
        untilCrash.set(Int.MAX_VALUE)
    }

    override fun send(userId: Long, title: String, tag: String?) {
        if (untilCrash.getAndDecrement() <= 0) {
            untilCrash.set(Int.MAX_VALUE)
            throw SimulatedCrash()
        }
        if (!latency.isZero) Thread.sleep(latency)
        sent += Push(userId, title, tag, Thread.currentThread().name)
    }
}
