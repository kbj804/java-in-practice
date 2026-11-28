package kr.aloui.community.post

import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import java.time.Duration

/**
 * 외부 LLM 으로 본문에서 장소를 뽑는다고 가정한 가짜 클라이언트.
 * 실제 네트워크 호출 대신 delay 만큼 스레드를 멈춘다(블로킹 I/O 와 같은 효과).
 */
@Component
class PlaceTagger(
    @Value("\${place-tagger.delay:0ms}") private val delay: Duration,
) {
    fun suggest(content: String): String? {
        Thread.sleep(delay)
        return PLACE.find(content)?.value
    }

    private companion object {
        val PLACE = Regex("""\S+(역|공원|시장)""")
    }
}
