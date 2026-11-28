package kr.aloui.community.cache

import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.data.redis.core.script.DefaultRedisScript
import org.springframework.stereotype.Component
import java.time.Duration
import java.util.UUID

/**
 * 가장 단순한 Valkey(Redis) 분산 락. 캐시를 다시 만드는 사람을 한 명으로 줄이는 "효율용" 락이다.
 * 가끔 두 명이 잡아도 DB 조회가 한 번 더 될 뿐이라, 펜싱(step05)까지는 두지 않는다.
 * 운영에서는 Redisson 의 RLock 처럼 검증된 구현을 쓰는 편이 낫다. 여기서는 NX · PX 가 하는 일을 보이려고 직접 쓴다.
 */
@Component
class ValkeyLock(private val redis: StringRedisTemplate) {

    /**
     * `SET key token NX PX ttl` — 키가 없을 때만(NX) 쓰고, ttl 뒤 저절로 지워지게(PX) 한다.
     * 동시에 여럿이 보내도 Valkey 는 명령을 하나씩 처리하므로 한 명만 성공한다. 성공하면 내 토큰을 돌려준다.
     * PX 는 step05 의 리스와 같다. 락을 쥔 서버가 죽어도 ttl 뒤에는 다른 요청이 다시 잡는다.
     */
    fun tryLock(key: String, ttl: Duration): String? {
        val token = UUID.randomUUID().toString()
        return if (redis.opsForValue().setIfAbsent(key, token, ttl) == true) token else null
    }

    /**
     * 값이 내 토큰일 때만 지운다. 그냥 DEL 하면, 멈췄다 깨어난 내가 ttl 이 지나 남이 새로 잡은 락을 지울 수 있다.
     * "읽고 비교하고 지우기"를 Lua 로 한 번에 실행해 그 사이에 다른 명령이 끼어들지 못하게 한다.
     */
    fun unlock(key: String, token: String): Boolean = redis.execute(UNLOCK, listOf(key), token) == 1L

    private companion object {
        val UNLOCK = DefaultRedisScript(
            """
            if redis.call('GET', KEYS[1]) == ARGV[1] then
                return redis.call('DEL', KEYS[1])
            end
            return 0
            """.trimIndent(),
            Long::class.javaObjectType,
        )
    }
}
