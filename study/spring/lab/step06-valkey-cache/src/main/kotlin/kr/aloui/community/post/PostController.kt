package kr.aloui.community.post

import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Positive
import jakarta.validation.constraints.Size
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.time.Instant

@RestController
@RequestMapping("/posts")
class PostController(private val postService: PostService) {

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@Valid @RequestBody request: CreatePostRequest): PostResponse =
        PostResponse.from(postService.create(request.authorId, request.regionId, request.content, title = request.title))

    /** 제목 고치기. */
    @PatchMapping("/{id}")
    fun rename(@PathVariable id: Long, @Valid @RequestBody request: RenamePostRequest): PostResponse =
        PostResponse.from(postService.rename(id, request.title))

    /** 신고로 가리기. */
    @PostMapping("/{id}/blind")
    fun blind(@PathVariable id: Long): PostResponse = PostResponse.from(postService.blind(id))

    @GetMapping("/{id}")
    fun get(@PathVariable id: Long): PostResponse = PostResponse.from(postService.get(id))

    @GetMapping
    fun list(
        @RequestParam regionId: Long,
        @RequestParam(defaultValue = "20") limit: Int,
    ): List<PostResponse> = postService.listByRegion(regionId, limit.coerceIn(1, 50)).map(PostResponse::from)
}

data class CreatePostRequest(
    @field:Positive val authorId: Long,
    @field:Positive val regionId: Long,
    @field:NotBlank @field:Size(max = 2000) val content: String,
    // step06 에서 추가. 없으면 본문 앞 30자를 제목으로 쓴다(앞 단계 요청도 그대로 받는다).
    @field:Size(max = 100) val title: String? = null,
)

data class RenamePostRequest(@field:NotBlank @field:Size(max = 100) val title: String)

data class PostResponse(
    val id: Long,
    val authorId: Long,
    val regionId: Long,
    val content: String,
    val createdAt: Instant,
    val placeTag: String?,
    val title: String,
    val blinded: Boolean,
) {
    companion object {
        fun from(post: Post) = PostResponse(
            id = requireNotNull(post.id),
            authorId = post.authorId,
            regionId = post.regionId,
            content = post.content,
            createdAt = post.createdAt,
            placeTag = post.placeTag,
            title = post.title,
            blinded = post.blindedAt != null,
        )
    }
}
