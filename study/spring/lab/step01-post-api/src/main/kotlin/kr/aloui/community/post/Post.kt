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
) {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set
}
