package kr.aloui.community.cache

import org.springframework.beans.factory.annotation.Value
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.data.redis.core.script.DefaultRedisScript
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import java.time.Duration
import java.util.concurrent.atomic.AtomicInteger

/**
 * 동네 최신 글 목록 `region:{id}:latest`. 값은 글 ID 만 담고, 제목은 글마다 `post:{id}` 에 따로 둔다.
 *
 * Sorted Set(점수 = 글 ID)을 쓴다. List(LPUSH)와 달리
 *  - 같은 글을 두 번 넣어도(ZADD) 한 번만 들어간다. RabbitMQ 는 같은 메시지를 두 번 줄 수 있다(step04).
 *  - 이벤트가 늦게 와도 점수로 정렬되어 순서가 꼬이지 않는다.
 *  - 값으로 뺀다(ZREM). 제목까지 한 값에 넣고 자리 번호로 고쳐 쓰는(LSET) 일이 없어서, 끼어든 새 글 때문에 남의 글을 덮어쓰지 않는다.
 *
 * 키가 있으면 "완전한 목록"이라는 뜻이 되도록, 다시 만들 때 표시용 원소 "0"(점수 -1)을 함께 넣는다.
 * 글이 하나도 없는 동네도 키가 생겨서 매번 DB 로 가지 않는다.
 */
@Component
class RegionFeedCache(
    private val redis: StringRedisTemplate,
    private val jdbc: JdbcClient,
    private val lock: ValkeyLock,
    @Value("\${cache.feed.keep:100}") private val keep: Int,
    @Value("\${cache.feed.ttl:PT10M}") private val ttl: Duration,
    @Value("\${cache.feed.jitter:PT2M}") private val jitter: Duration,
    @Value("\${cache.feed.lock-ttl:PT0.5S}") private val lockTtl: Duration,
    @Value("\${cache.feed.wait-step:PT0.02S}") private val waitStep: Duration,
    @Value("\${cache.feed.wait-max:10}") private val waitMax: Int,
    @Value("\${cache.feed.rebuild-delay:PT0S}") private val rebuildDelay: Duration,
) {
    /** DB 에서 목록을 다시 만든 횟수. 스탬피드 실험에서 센다. */
    val rebuilds = AtomicInteger()

    /** 가: 캐시에 없으면 각자 DB 에서 다시 만든다. 키가 빈 순간에 몰린 요청 수만큼 DB 에 간다. */
    fun idsWithoutLock(regionId: Long, count: Int): List<Long> = read(regionId, count) ?: rebuild(regionId).take(count)

    /**
     * 나: single-flight. 캐시에 없으면 락을 잡은 한 명만 DB 에서 다시 만들고,
     * 나머지는 wait-step 마다 캐시를 다시 본다. wait-max 번 다 봐도 없으면(락을 쥔 쪽이 죽었거나 아주 느림) DB 에서 직접 만든다.
     */
    fun ids(regionId: Long, count: Int): List<Long> {
        read(regionId, count)?.let { return it }
        val lockKey = CacheKeys.feedLock(regionId)
        val token = lock.tryLock(lockKey, lockTtl)
        if (token != null) {
            try {
                // 내가 락을 잡는 사이에 앞사람이 이미 채웠을 수 있다. 한 번 더 보고 없을 때만 DB 로 간다.
                return read(regionId, count) ?: rebuild(regionId).take(count)
            } finally {
                lock.unlock(lockKey, token)
            }
        }
        repeat(waitMax) {
            Thread.sleep(waitStep)
            read(regionId, count)?.let { return it }
        }
        return rebuild(regionId).take(count)
    }

    /** 새 글 이벤트: 목록 키가 있을 때만 넣고 keep 개를 넘으면 오래된 것을 잘라 낸다. */
    fun addIfPresent(regionId: Long, postId: Long): Boolean =
        redis.execute(ADD_IF_PRESENT, listOf(CacheKeys.feed(regionId)), postId.toString(), keep.toString()) == 1L

    /** 블라인드 이벤트: `ZREM` 으로 값을 뺀다. 목록 키는 지우지 않으니 사람이 몰려도 빈 순간이 없다. */
    fun remove(regionId: Long, postId: Long) {
        redis.opsForZSet().remove(CacheKeys.feed(regionId), postId.toString())
    }

    /** 최신 순으로 count 개. 키가 없으면 null (표시용 원소 "0" 이 있으므로 빈 집합 = 키 없음). */
    private fun read(regionId: Long, count: Int): List<Long>? {
        val members = redis.opsForZSet().reverseRange(CacheKeys.feed(regionId), 0, count.toLong()).orEmpty()
        if (members.isEmpty()) return null
        return members.filter { it != SENTINEL }.map(String::toLong).take(count)
    }

    /** DB 에서 최신 keep 개를 읽어, 지우기·채우기·만료 설정을 Lua 로 한 번에 바꿔 넣는다. 읽는 쪽은 빈 목록을 보지 않는다. */
    private fun rebuild(regionId: Long): List<Long> {
        rebuilds.incrementAndGet()
        val ids = jdbc.sql(
            """
            with slow as materialized (select pg_sleep(:delay))
            select p.id from post p, slow
            where p.region_id = :regionId and p.blinded_at is null
            order by p.id desc limit :keep
            """.trimIndent(),
        )
            .param("delay", rebuildDelay.toMillis() / 1000.0) // 실험용으로 쿼리를 느리게 한다. materialized 라 행마다가 아니라 한 번만 잔다. 0 이면 바로 돈다
            .param("regionId", regionId)
            .param("keep", keep)
            .query { rs, _ -> rs.getLong(1) }
            .list()
        val ttlMillis = ttlWithJitter(ttl, jitter).toMillis().toString()
        redis.execute(REPLACE, listOf(CacheKeys.feed(regionId)), ttlMillis, *ids.map { it.toString() }.toTypedArray())
        return ids
    }

    private companion object {
        const val SENTINEL = "0"

        // 점수와 값이 모두 글 ID. 점수가 double 이라 2^53 을 넘는 ID(64비트 Snowflake 등)는 점수로 그대로 쓰면 뭉개진다.
        // 그때는 점수를 생성 시각(ms)으로 두면 된다.
        val REPLACE = DefaultRedisScript(
            """
            redis.call('DEL', KEYS[1])
            redis.call('ZADD', KEYS[1], -1, '0')
            for i = 2, #ARGV do
                redis.call('ZADD', KEYS[1], ARGV[i], ARGV[i])
            end
            redis.call('PEXPIRE', KEYS[1], ARGV[1])
            return #ARGV - 1
            """.trimIndent(),
            Long::class.javaObjectType,
        )

        // 키가 없을 때 넣으면 글 하나짜리 "반쪽 목록"이 생겨 완전한 목록으로 읽힌다. 그래서 있을 때만 넣는다.
        // 순위 0 은 표시용 "0"(점수 -1)이라, 1 ~ -(keep+1) 을 지우면 표시용 + 최신 keep 개가 남는다.
        val ADD_IF_PRESENT = DefaultRedisScript(
            """
            if redis.call('EXISTS', KEYS[1]) == 0 then
                return 0
            end
            redis.call('ZADD', KEYS[1], ARGV[1], ARGV[1])
            redis.call('ZREMRANGEBYRANK', KEYS[1], 1, -(tonumber(ARGV[2]) + 1))
            return 1
            """.trimIndent(),
            Long::class.javaObjectType,
        )
    }
}
