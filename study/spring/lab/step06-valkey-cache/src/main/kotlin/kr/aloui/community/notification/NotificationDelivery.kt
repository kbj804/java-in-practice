package kr.aloui.community.notification

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.UUID

/**
 * 이웃 한 명에게 보낼 알림 한 건 (inbox 행).
 * 쓰기는 모두 아래 리포지토리의 네이티브 쿼리로 한다. 엔티티는 조회와 스키마 확인(ddl-auto=validate)용이다.
 */
@Entity
@Table(name = "notification_delivery")
class NotificationDelivery(
    @Column(nullable = false) val eventId: UUID,
    @Column(nullable = false) val postId: Long,
    @Column(nullable = false) val userId: Long,
    @Column(nullable = false, length = 20) val state: String,
    val claimedAt: Instant?,
    val completedAt: Instant?,
    @Column(nullable = false) val createdAt: Instant,
) {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set
}

/** 가져가기(claim) 결과 한 행. 네이티브 쿼리의 RETURNING 열 이름과 getter 이름을 맞춘다. */
interface ClaimedDelivery {
    val id: Long
    val eventId: UUID
    val postId: Long
    val userId: Long
}

interface NotificationDeliveryRepository : JpaRepository<NotificationDelivery, Long> {

    /**
     * ② 행 만들기. 그 동네 이웃 수만큼 pending 행을 한 번에 만든다.
     * 같은 (event_id, user_id) 가 이미 있으면 에러 대신 건너뛴다. 돌려주는 값은 실제로 새로 만든 행 수.
     *
     * JPQL 에는 ON CONFLICT 가 없어서 네이티브 쿼리로 쓴다.
     * 리포지토리 인터페이스에 직접 선언한 쿼리에는 트랜잭션이 붙지 않으므로 @Transactional 을 단다.
     */
    @Modifying
    @Transactional
    @Query(
        nativeQuery = true,
        value = """
            insert into notification_delivery (event_id, post_id, user_id, state, created_at)
            select :eventId, :postId, m.user_id, 'pending', :now
            from region_member m
            where m.region_id = :regionId
            on conflict (event_id, user_id) do nothing
        """,
    )
    fun acceptForRegion(eventId: UUID, postId: Long, regionId: Long, now: Instant): Int

    /**
     * ③ 가져가기. pending 이거나, processing 인데 리스가 지난 행을 limit 개까지 processing 으로 바꾸고 그 행을 돌려준다.
     *
     * - `for update skip locked`: 다른 워커가 같은 순간 가져가는 중인 행은 기다리지 않고 건너뛴다.
     * - `returning`: 바뀐 행 수가 아니라 바뀐 행 자체를 받는다. 그래서 "내 몫"이 누구인지 안다.
     *   Hibernate(HQL)에는 RETURNING 이 없어 네이티브 쿼리로 쓴다.
     *   @Modifying 을 달면 바뀐 행 수(Int)만 돌려주므로 일부러 달지 않는다. 그러면 결과 행을 SELECT 처럼 받는다.
     * - 시각은 앱에서 주입받은 Clock 으로 넘긴다. 서버 간 시계 오차(NTP 로 ms 단위)보다 리스(30초)가 훨씬 길다.
     */
    @Transactional
    @Query(
        nativeQuery = true,
        value = """
            update notification_delivery
            set state = 'processing', claimed_at = :now
            where id in (
                select id from notification_delivery
                where state = 'pending'
                   or (state = 'processing' and claimed_at < :leaseExpiredBefore)
                order by id
                limit :limit
                for update skip locked
            )
            returning id as "id", event_id as "eventId", post_id as "postId", user_id as "userId"
        """,
    )
    fun claim(now: Instant, leaseExpiredBefore: Instant, limit: Int): List<ClaimedDelivery>

    /** ⑤ 끝내기. */
    @Modifying
    @Transactional
    @Query(
        nativeQuery = true,
        value = """
            update notification_delivery
            set state = 'completed', completed_at = :now
            where id in (:ids) and state = 'processing'
        """,
    )
    fun complete(ids: Collection<Long>, now: Instant): Int

    fun countByEventIdAndState(eventId: UUID, state: String): Long

    /** 그 동네 이웃 id. inbox 없이 바로 보내는 비교용 리스너가 쓴다. */
    @Query(nativeQuery = true, value = "select user_id from region_member where region_id = :regionId order by user_id")
    fun memberIds(regionId: Long): List<Long>
}
