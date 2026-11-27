package kr.aloui.community.post

import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

/*
 * 실험 ①: 트랜잭션 안의 외부 호출이 커넥션 풀을 고갈시키는지 비교한다. (notes/02-connection-pool.md)
 */

// 나쁜 버전: 트랜잭션이 열린 채로(= 커넥션을 쥔 채로) 외부 호출을 기다린다.
@Service
class InsideTxPostWriter(
    private val postService: PostService,
    private val placeTagger: PlaceTagger,
) {
    @Transactional
    fun write(authorId: Long, regionId: Long, content: String): Post {
        val post = postService.create(authorId, regionId, content) // 바깥 트랜잭션에 합류한다
        post.placeTag = placeTagger.suggest(content) // 이 동안 커넥션을 쥐고 있다
        // save 를 다시 부르지 않아도 된다. post 는 이 트랜잭션이 관리 중인 객체라
        // 커밋할 때 Hibernate 가 바뀐 값을 찾아 UPDATE 한다(dirty checking).
        return post
    }
}

// 좋은 버전: 외부 호출을 먼저 끝내고, 저장할 때만 짧게 트랜잭션을 연다.
// 이 메서드에는 @Transactional 을 붙이지 않는다. 트랜잭션은 다른 Bean(PostService)의 메서드에서 열린다.
@Service
class OutsideTxPostWriter(
    private val postService: PostService,
    private val placeTagger: PlaceTagger,
) {
    fun write(authorId: Long, regionId: Long, content: String): Post {
        val placeTag = placeTagger.suggest(content) // 커넥션 없이 기다린다
        return postService.create(authorId, regionId, content, placeTag)
    }
}

@RestController
@RequestMapping("/experiments/pool")
class PoolExperimentController(
    private val insideTx: InsideTxPostWriter,
    private val outsideTx: OutsideTxPostWriter,
) {
    @PostMapping("/inside-tx")
    @ResponseStatus(HttpStatus.CREATED)
    fun inside(@RequestBody request: CreatePostRequest): PostResponse =
        PostResponse.from(insideTx.write(request.authorId, request.regionId, request.content))

    @PostMapping("/outside-tx")
    @ResponseStatus(HttpStatus.CREATED)
    fun outside(@RequestBody request: CreatePostRequest): PostResponse =
        PostResponse.from(outsideTx.write(request.authorId, request.regionId, request.content))
}
