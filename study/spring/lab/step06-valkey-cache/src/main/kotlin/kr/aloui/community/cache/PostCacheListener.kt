package kr.aloui.community.cache

import kr.aloui.community.message.CACHE_QUEUE
import kr.aloui.community.post.POST_BLINDED
import kr.aloui.community.post.POST_CREATED
import kr.aloui.community.post.POST_UPDATED
import kr.aloui.community.post.PostEventPayload
import org.springframework.amqp.rabbit.annotation.RabbitListener
import org.springframework.beans.factory.annotation.Value
import org.springframework.scheduling.TaskScheduler
import org.springframework.stereotype.Component
import tools.jackson.databind.json.JsonMapper
import java.time.Duration
import java.util.concurrent.atomic.AtomicInteger
import org.springframework.amqp.core.Message as AmqpMessage

/**
 * 글 요약을 지운다. 바로 한 번 지우고, double-delete-delay 뒤 한 번 더 지운다(지연 이중 삭제).
 *
 * 두 번째 삭제가 막는 것: DB 에서 옛 값을 읽은 요청이 멈췄다가, 첫 삭제 뒤에 그 옛 값을 캐시에 넣는 경우.
 * 그 요청의 SET 이 지연 시간 안에 끝났다면 두 번째 삭제가 지운다. 더 늦은 SET 은 TTL 이 지운다.
 * 두 번째 삭제는 이 서버 메모리에 걸어 둔 예약이라, 그 사이에 서버가 죽으면 사라진다(그래도 TTL 이 남는다).
 */
@Component
class PostEviction(
    private val posts: PostCache,
    private val scheduler: TaskScheduler,
    @Value("\${cache.post.double-delete-delay:PT1S}") private val delay: Duration,
) {
    fun evict(postId: Long) {
        posts.evict(postId)
        if (!delay.isZero) scheduler.schedule({ posts.evict(postId) }, scheduler.clock.instant().plus(delay))
    }
}

/**
 * 캐시 리스너. 글 쓰는 API 는 Valkey 를 모르고, outbox → RabbitMQ 로 온 이벤트를 보고 여기서 캐시를 고친다.
 * 기본 ackMode(AUTO): 정상으로 끝나면 ack, 예외면 메시지를 큐로 되돌려 다시 받는다. 세 처리 모두 두 번 해도 결과가 같다.
 */
@Component
class PostCacheListener(
    private val feed: RegionFeedCache,
    private val eviction: PostEviction,
    private val jsonMapper: JsonMapper,
) {
    /** 처리한 메시지 수. 테스트가 기다리는 데 쓴다. */
    val handled = AtomicInteger()

    @RabbitListener(queues = [CACHE_QUEUE])
    fun onMessage(message: AmqpMessage) {
        val event = jsonMapper.readValue(message.body, PostEventPayload::class.java)
        when (message.messageProperties.type) {
            POST_CREATED -> feed.addIfPresent(event.regionId, event.postId) // 목록 맨 앞에 (키가 있을 때만)
            POST_UPDATED -> eviction.evict(event.postId) // 제목이 바뀜: 요약만 지운다. 목록의 ID 는 그대로
            POST_BLINDED -> {
                feed.remove(event.regionId, event.postId) // 목록에서 빼고
                eviction.evict(event.postId) // 요약도 지운다
            }
        }
        handled.incrementAndGet()
    }
}
