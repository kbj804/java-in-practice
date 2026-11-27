package kr.aloui.community.post

import org.springframework.data.domain.Limit
import org.springframework.data.repository.findByIdOrNull
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.ResponseStatus
import java.time.Clock

@Service
class PostService(
    private val postRepository: PostRepository,
    private val clock: Clock,
) {
    // 메서드가 시작될 때 트랜잭션을 열고, 정상 종료면 커밋, RuntimeException 이면 롤백한다.
    @Transactional
    fun create(authorId: Long, regionId: Long, content: String): Post =
        postRepository.save(
            Post(authorId = authorId, regionId = regionId, content = content, createdAt = clock.instant()),
        )

    @Transactional(readOnly = true)
    fun get(id: Long): Post = postRepository.findByIdOrNull(id) ?: throw PostNotFoundException(id)

    @Transactional(readOnly = true)
    fun listByRegion(regionId: Long, limit: Int): List<Post> =
        postRepository.findByRegionIdOrderByCreatedAtDesc(regionId, Limit.of(limit))
}

@ResponseStatus(HttpStatus.NOT_FOUND)
class PostNotFoundException(id: Long) : RuntimeException("post $id not found")
