package kr.aloui.community.outbox

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.LockModeType
import jakarta.persistence.QueryHint
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import org.springframework.data.domain.Limit
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.jpa.repository.QueryHints
import java.time.Instant
import java.util.UUID

/** 업무 데이터와 같은 트랜잭션에서 저장하는 "보낼 메시지" 한 건. */
@Entity
@Table(name = "outbox_event")
class OutboxEvent(
    @Column(nullable = false, unique = true)
    val eventId: UUID,

    @Column(nullable = false, length = 50)
    val aggregateType: String,

    @Column(nullable = false)
    val aggregateId: Long,

    @Column(nullable = false, length = 100)
    val eventType: String,

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    val payload: String,

    @Column(nullable = false)
    val createdAt: Instant,
) {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set

    var publishedAt: Instant? = null

    @Column(nullable = false)
    var attempts: Int = 0

    @Column(length = 500)
    var lastError: String? = null
}

interface OutboxEventRepository : JpaRepository<OutboxEvent, Long> {
    /**
     * 아직 안 보낸 행을 잠그면서 가져온다. 다른 릴레이가 이미 잠근 행은 기다리지 않고 건너뛴다.
     * PostgreSQL 에서 `... for no key update skip locked` 로 나간다. (lock.timeout -2 = SKIP LOCKED)
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints(QueryHint(name = "jakarta.persistence.lock.timeout", value = "-2"))
    @Query("select e from OutboxEvent e where e.publishedAt is null order by e.id")
    fun lockUnpublished(limit: Limit): List<OutboxEvent>

    fun countByPublishedAtIsNull(): Long
}
