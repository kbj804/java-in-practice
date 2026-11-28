package kr.aloui.community.cache

import kr.aloui.community.post.PostEventPayload
import org.springframework.amqp.core.Queue
import org.springframework.amqp.core.QueueBuilder
import org.springframework.amqp.rabbit.annotation.RabbitListener
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.stereotype.Component
import tools.jackson.databind.json.JsonMapper
import java.util.concurrent.atomic.AtomicInteger
import org.springframework.amqp.core.Message as AmqpMessage

// 실험 ⑤: 캐시 설계에서 한 줄씩 빼 보면 무엇이 깨지나.
// 실험용 큐는 exchange 에 묶지 않는다. 테스트가 기본 exchange("")로 큐 이름을 지정해 직접 넣는다.

/** 가: 제목이 바뀌면 한 번만 지운다(지연 이중 삭제 없음). */
const val EXPERIMENT_SINGLE_DELETE_QUEUE = "experiment.cache.single-delete"

@Configuration
class CacheExperimentQueues {
    @Bean
    fun singleDeleteQueue(): Queue = QueueBuilder.durable(EXPERIMENT_SINGLE_DELETE_QUEUE).build()
}

@Component
class SingleDeleteCacheListener(private val posts: PostCache, private val jsonMapper: JsonMapper) {
    val handled = AtomicInteger()

    @RabbitListener(queues = [EXPERIMENT_SINGLE_DELETE_QUEUE])
    fun onMessage(message: AmqpMessage) {
        posts.evict(jsonMapper.readValue(message.body, PostEventPayload::class.java).postId)
        handled.incrementAndGet()
    }
}
