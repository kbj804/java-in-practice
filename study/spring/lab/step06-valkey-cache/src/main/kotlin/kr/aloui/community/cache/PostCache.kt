package kr.aloui.community.cache

import kr.aloui.community.post.Post
import kr.aloui.community.post.PostRepository
import org.springframework.beans.factory.annotation.Value
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.stereotype.Component
import tools.jackson.databind.json.JsonMapper
import java.time.Duration
import java.time.Instant
import java.util.concurrent.atomic.AtomicInteger

/** 목록 화면에 보이는 글 요약. 본문은 담지 않는다. */
data class PostSummary(
    val id: Long,
    val regionId: Long,
    val authorId: Long,
    val title: String,
    val createdAt: Instant,
) {
    companion object {
        fun from(post: Post) = PostSummary(requireNotNull(post.id), post.regionId, post.authorId, post.title, post.createdAt)
    }
}

/**
 * 글 요약 캐시 `post:{id}`. cache-aside: 읽을 때 없으면 DB 에서 읽어 채우고, 바뀌면 지운다(덮어쓰지 않는다).
 * 지우는 쪽이 이벤트 순서가 뒤바뀌거나 두 번 와도 결과가 같아서 안전하다.
 */
@Component
class PostCache(
    private val redis: StringRedisTemplate,
    private val posts: PostRepository,
    private val jsonMapper: JsonMapper,
    @Value("\${cache.post.ttl:PT10M}") private val ttl: Duration,
    @Value("\${cache.post.jitter:PT2M}") private val jitter: Duration,
) {
    /** DB 에서 읽은 글 수. 실험에서 캐시가 DB 를 얼마나 막아 줬는지 센다. */
    val dbReads = AtomicInteger()

    /** 여러 글을 한 번에(MGET) 읽고, 없는 것만 DB 에서 읽어 채운다. 순서는 ids 순서. 가려진 글은 빠진다. */
    fun getAll(ids: List<Long>): List<PostSummary> {
        if (ids.isEmpty()) return emptyList()
        val cached = redis.opsForValue().multiGet(ids.map(CacheKeys::post)).orEmpty()
        val found = HashMap<Long, PostSummary>()
        ids.forEachIndexed { i, id -> cached.getOrNull(i)?.let { found[id] = parse(it) } }
        val missing = ids.filterNot(found::containsKey)
        if (missing.isNotEmpty()) {
            for (post in loadFromDb(missing)) {
                put(post)
                found[post.id] = post
            }
        }
        return ids.mapNotNull(found::get)
    }

    /** DB 에서 읽기만 하고 캐시에는 쓰지 않는다. 실험에서 "DB 를 읽고 멈춘 요청"을 만들 때 따로 부른다. */
    fun loadFromDb(ids: Collection<Long>): List<PostSummary> {
        dbReads.addAndGet(ids.size)
        return posts.findAllById(ids).filter { it.blindedAt == null }.map(PostSummary::from)
    }

    /** `SET post:{id} json EX (ttl + 지터)`. */
    fun put(post: PostSummary) {
        redis.opsForValue().set(CacheKeys.post(post.id), jsonMapper.writeValueAsString(post), ttlWithJitter(ttl, jitter))
    }

    /** `DEL post:{id}`. 다음에 읽는 사람이 DB 에서 새 값을 읽어 채운다. */
    fun evict(postId: Long) {
        redis.delete(CacheKeys.post(postId))
    }

    /** 캐시에 지금 들어 있는 값(없으면 null). DB 로 가지 않는다. */
    fun peek(postId: Long): PostSummary? = redis.opsForValue().get(CacheKeys.post(postId))?.let(::parse)

    private fun parse(json: String) = jsonMapper.readValue(json, PostSummary::class.java)
}
