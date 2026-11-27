package kr.aloui.community.post

import org.springframework.data.domain.Limit
import org.springframework.data.jpa.repository.JpaRepository

// 인터페이스만 선언하면 Spring Data 가 구현체를 만든다. 메서드 이름이 곧 쿼리다.
interface PostRepository : JpaRepository<Post, Long> {
    fun findByRegionIdOrderByCreatedAtDesc(regionId: Long, limit: Limit): List<Post>
}
