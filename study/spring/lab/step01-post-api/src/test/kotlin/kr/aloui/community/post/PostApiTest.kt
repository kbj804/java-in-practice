package kr.aloui.community.post

import kr.aloui.community.TestcontainersConfiguration
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.context.annotation.Import
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.assertj.MockMvcTester

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration::class)
class PostApiTest(@Autowired private val mvc: MockMvcTester) {

    @Test
    fun `게시글을 쓰고 id 로 조회한다`() {
        val created = mvc.post().uri("/posts")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"authorId": 1, "regionId": 100, "content": "동네 붕어빵 어디서 팔아요?"}""")
            .exchange()

        assertThat(created).hasStatus(201)
        assertThat(created).bodyJson().extractingPath("$.createdAt").isEqualTo("2026-11-21T00:00:00Z")
        val id = (created.response.contentAsString.substringAfter("\"id\":").substringBefore(",")).toLong()

        assertThat(mvc.get().uri("/posts/$id"))
            .hasStatusOk()
            .bodyJson().extractingPath("$.content").isEqualTo("동네 붕어빵 어디서 팔아요?")
    }

    @Test
    fun `지역별 목록은 최신 글부터 보여 준다`() {
        listOf("첫 글", "둘째 글").forEach { content ->
            mvc.post().uri("/posts")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"authorId": 1, "regionId": 200, "content": "$content"}""")
                .exchange()
        }

        assertThat(mvc.get().uri("/posts?regionId=200"))
            .hasStatusOk()
            .bodyJson().extractingPath("$.length()").isEqualTo(2)
    }

    @Test
    fun `없는 글은 404`() {
        assertThat(mvc.get().uri("/posts/999999")).hasStatus(404)
    }

    @Test
    fun `빈 본문은 400`() {
        val result = mvc.post().uri("/posts")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"authorId": 1, "regionId": 100, "content": ""}""")
            .exchange()

        assertThat(result).hasStatus(400)
    }
}
