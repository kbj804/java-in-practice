package kr.aloui.community.post

import kr.aloui.community.outbox.OutboxEvent
import kr.aloui.community.outbox.OutboxEventRepository
import org.springframework.data.domain.Limit
import org.springframework.data.repository.findByIdOrNull
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.ResponseStatus
import tools.jackson.databind.json.JsonMapper
import java.time.Clock
import java.util.UUID

/** 글이 생겼다는 이벤트. outbox 에 적고, 릴레이가 RabbitMQ 로 보낸다. */
const val POST_CREATED = "PostCreated"

data class PostCreatedPayload(val postId: Long, val regionId: Long)

@Service
class PostService(
    private val postRepository: PostRepository,
    private val outbox: OutboxEventRepository,
    private val jsonMapper: JsonMapper,
    private val clock: Clock,
) {
    // 메서드가 시작될 때 트랜잭션을 열고, 정상 종료면 커밋, RuntimeException 이면 롤백한다.
    // step03 의 "다(outbox)" 방식을 기본 글쓰기에 넣었다. 글과 outbox 행은 함께 커밋되거나 함께 롤백된다.
    @Transactional
    fun create(authorId: Long, regionId: Long, content: String, placeTag: String? = null): Post {
        val post = postRepository.save(
            Post(
                authorId = authorId,
                regionId = regionId,
                content = content,
                createdAt = clock.instant(),
                placeTag = placeTag,
            ),
        )
        outbox.save(
            OutboxEvent(
                eventId = UUID.randomUUID(),
                aggregateType = "post",
                aggregateId = post.id!!,
                eventType = POST_CREATED,
                payload = jsonMapper.writeValueAsString(PostCreatedPayload(post.id!!, post.regionId)),
                createdAt = clock.instant(),
            ),
        )
        return post
    }

    @Transactional(readOnly = true)
    fun get(id: Long): Post = postRepository.findByIdOrNull(id) ?: throw PostNotFoundException(id)

    @Transactional(readOnly = true)
    fun listByRegion(regionId: Long, limit: Int): List<Post> =
        postRepository.findByRegionIdOrderByCreatedAtDesc(regionId, Limit.of(limit))
}

@ResponseStatus(HttpStatus.NOT_FOUND)
class PostNotFoundException(id: Long) : RuntimeException("post $id not found")
