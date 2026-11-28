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

/** 제목이 바뀌었다는 이벤트. 캐시 리스너가 post:{id} 를 지운다. */
const val POST_UPDATED = "PostUpdated"

/** 신고로 가렸다는 이벤트. 캐시 리스너가 목록에서 빼고 post:{id} 를 지운다. */
const val POST_BLINDED = "PostBlinded"

/** 글 이벤트의 내용. 받는 쪽은 이 두 값으로 어떤 캐시 키를 고칠지 안다. */
data class PostEventPayload(val postId: Long, val regionId: Long)

/** step04 의 알림 워커가 쓰는 이름. 내용은 같다. */
typealias PostCreatedPayload = PostEventPayload

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
    fun create(authorId: Long, regionId: Long, content: String, placeTag: String? = null, title: String? = null): Post {
        val post = postRepository.save(
            Post(
                authorId = authorId,
                regionId = regionId,
                content = content,
                createdAt = clock.instant(),
                placeTag = placeTag,
                title = title ?: content.take(30), // 제목을 안 주면 본문 앞부분
            ),
        )
        record(post, POST_CREATED)
        return post
    }

    /** 제목 고치기. 글과 "바뀌었다" 이벤트를 한 트랜잭션에 적는다. 캐시는 이 이벤트를 받은 리스너가 고친다. */
    @Transactional
    fun rename(id: Long, title: String): Post {
        val post = get(id)
        post.title = title
        record(post, POST_UPDATED)
        return post
    }

    /** 신고로 가리기. */
    @Transactional
    fun blind(id: Long): Post {
        val post = get(id)
        post.blindedAt = clock.instant()
        record(post, POST_BLINDED)
        return post
    }

    private fun record(post: Post, eventType: String) {
        outbox.save(
            OutboxEvent(
                eventId = UUID.randomUUID(),
                aggregateType = "post",
                aggregateId = post.id!!,
                eventType = eventType,
                payload = jsonMapper.writeValueAsString(PostEventPayload(post.id!!, post.regionId)),
                createdAt = clock.instant(),
            ),
        )
    }

    @Transactional(readOnly = true)
    fun get(id: Long): Post = postRepository.findByIdOrNull(id) ?: throw PostNotFoundException(id)

    @Transactional(readOnly = true)
    fun listByRegion(regionId: Long, limit: Int): List<Post> =
        postRepository.findByRegionIdOrderByCreatedAtDesc(regionId, Limit.of(limit))
}

@ResponseStatus(HttpStatus.NOT_FOUND)
class PostNotFoundException(id: Long) : RuntimeException("post $id not found")
