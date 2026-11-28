package kr.aloui.community.post

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant

@Entity
@Table(name = "post")
class Post(
    @Column(nullable = false)
    val authorId: Long,

    @Column(nullable = false)
    val regionId: Long,

    @Column(nullable = false, length = 2000)
    var content: String,

    @Column(nullable = false)
    val createdAt: Instant,

    @Column(length = 100)
    var placeTag: String? = null,

    /** 목록에 보이는 제목. 동네 최신 글 캐시에 함께 담긴다. */
    @Column(nullable = false, length = 100)
    var title: String = "",

    /** 신고로 가린 시각. null 이 아니면 목록에서 빠진다. */
    var blindedAt: Instant? = null,
) {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set
}
