package kr.aloui.community.cache

import java.time.Duration
import java.util.concurrent.ThreadLocalRandom

/** Valkey 키 이름. 이름만 보고 무엇의 캐시인지 알 수 있게 "종류:아이디:무엇" 으로 짓는다. */
object CacheKeys {
    /** 동네 최신 글 목록. Sorted Set, 값은 글 ID 만. */
    fun feed(regionId: Long) = "region:$regionId:latest"

    /** 글 요약 하나(제목 등). String 에 JSON. */
    fun post(postId: Long) = "post:$postId"

    /** 동네 목록을 다시 만드는 중이라는 표시(single-flight 락). */
    fun feedLock(regionId: Long) = "lock:region:$regionId"
}

/**
 * ttl 에 0 ~ jitter 사이 무작위 시간을 더한다.
 * 같은 때 채운 키들(배포 직후 등)이 같은 때 한꺼번에 만료돼 DB 로 몰리지 않게 만료 시각을 흩어 놓는다.
 */
fun ttlWithJitter(ttl: Duration, jitter: Duration): Duration =
    if (jitter.isZero) ttl else ttl.plusMillis(ThreadLocalRandom.current().nextLong(jitter.toMillis() + 1))
