package kr.aloui.community.cache

import org.springframework.stereotype.Service
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

/** 동네 최신 글 목록: ID 목록(region:{id}:latest) + 글마다 요약(post:{id}). */
@Service
class RegionFeed(private val feed: RegionFeedCache, private val posts: PostCache) {

    fun latest(regionId: Long, limit: Int = 20): List<PostSummary> =
        posts.getAll(feed.ids(regionId, limit + SPARE)).take(limit)

    /** 실험 가: 락 없이 각자 다시 만드는 목록. */
    fun latestWithoutLock(regionId: Long, limit: Int = 20): List<PostSummary> =
        posts.getAll(feed.idsWithoutLock(regionId, limit + SPARE)).take(limit)

    private companion object {
        // 목록과 요약 사이에 블라인드된 글이 걸러질 수 있어 몇 개 더 읽어 둔다
        const val SPARE = 10
    }
}

@RestController
class FeedController(private val feed: RegionFeed) {
    // step06 에서 추가. 앞 단계의 GET /posts?regionId= 는 그대로 DB 에서 읽는다.
    @GetMapping("/regions/{regionId}/feed")
    fun feed(@PathVariable regionId: Long, @RequestParam(defaultValue = "20") limit: Int): List<PostSummary> =
        feed.latest(regionId, limit.coerceIn(1, 50))
}
