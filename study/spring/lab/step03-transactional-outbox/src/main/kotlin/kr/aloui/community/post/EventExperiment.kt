package kr.aloui.community.post

import jakarta.validation.Valid
import kr.aloui.community.message.BrokerUnavailableException
import kr.aloui.community.message.Message
import kr.aloui.community.message.MessageBroker
import kr.aloui.community.outbox.OutboxEvent
import kr.aloui.community.outbox.OutboxEventRepository
import org.springframework.context.ApplicationEventPublisher
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.event.TransactionPhase
import org.springframework.transaction.event.TransactionalEventListener
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import tools.jackson.databind.json.JsonMapper
import java.time.Clock
import java.util.UUID

// 실험 ②: "글 저장"과 "글이 생겼다는 메시지 보내기"를 어떻게 묶을까.
// 세 방법 모두 글을 저장한 뒤 메시지를 보내려 한다. 차이는 메시지를 언제, 어디에 맡기느냐다.
//
// failAtEnd: 메시지를 맡긴 뒤 같은 트랜잭션의 뒤 단계가 실패하는 경우를 흉내 낸다(→ 롤백).

const val POST_CREATED = "PostCreated"

data class PostCreatedPayload(val postId: Long, val regionId: Long)

class LaterStepFailedException : RuntimeException("later step failed after the post was written")

/** 가: 트랜잭션 안에서 바로 브로커로 보낸다. 롤백돼도 이미 나간 메시지는 못 되돌린다. */
@Service
class BeforeCommitPostWriter(
    private val postService: PostService,
    private val broker: MessageBroker,
    private val jsonMapper: JsonMapper,
) {
    @Transactional
    fun write(authorId: Long, regionId: Long, content: String, failAtEnd: Boolean = false): Post {
        val post = postService.create(authorId, regionId, content)
        val payload = jsonMapper.writeValueAsString(PostCreatedPayload(post.id!!, post.regionId))
        broker.publish(Message(UUID.randomUUID().toString(), POST_CREATED, payload)) // 아직 커밋 전
        if (failAtEnd) throw LaterStepFailedException()
        return post
    }
}

/** 나: 커밋이 끝난 뒤에 보낸다(@TransactionalEventListener AFTER_COMMIT). 그 순간 브로커가 죽어 있으면 메시지는 사라진다. */
@Service
class AfterCommitPostWriter(
    private val postService: PostService,
    private val events: ApplicationEventPublisher,
) {
    @Transactional
    fun write(authorId: Long, regionId: Long, content: String, failAtEnd: Boolean = false): Post {
        val post = postService.create(authorId, regionId, content)
        events.publishEvent(PostCreatedPayload(post.id!!, post.regionId)) // 지금은 맡겨 두기만 한다
        if (failAtEnd) throw LaterStepFailedException()
        return post
    }
}

@Component
class PostCreatedAfterCommitSender(
    private val broker: MessageBroker,
    private val jsonMapper: JsonMapper,
) {
    // 커밋된 뒤에만 불린다. 롤백되면 불리지 않는다.
    // 여기서 던진 예외는 이미 끝난 트랜잭션을 되돌리지 못하고, 다시 보내 주는 곳도 없다.
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    fun send(event: PostCreatedPayload) {
        broker.publish(Message(UUID.randomUUID().toString(), POST_CREATED, jsonMapper.writeValueAsString(event)))
    }
}

/** 다: 메시지를 outbox 표에 글과 같은 트랜잭션으로 적는다. 보내는 일은 OutboxRelay 가 따로 한다. */
@Service
class OutboxPostWriter(
    private val postService: PostService,
    private val outbox: OutboxEventRepository,
    private val jsonMapper: JsonMapper,
    private val clock: Clock,
) {
    @Transactional
    fun write(authorId: Long, regionId: Long, content: String, failAtEnd: Boolean = false): Post {
        val post = postService.create(authorId, regionId, content)
        outbox.save(
            OutboxEvent(
                eventId = UUID.randomUUID(),
                aggregateType = "post",
                aggregateId = post.id!!,
                eventType = POST_CREATED,
                payload = jsonMapper.writeValueAsString(PostCreatedPayload(post.id!!, post.regionId)),
                createdAt = clock.instant(),
            ),
        ) // 글과 함께 커밋되거나, 함께 롤백된다
        if (failAtEnd) throw LaterStepFailedException()
        return post
    }
}

@RestController
@RequestMapping("/experiments/events")
class EventExperimentController(
    private val beforeCommit: BeforeCommitPostWriter,
    private val afterCommit: AfterCommitPostWriter,
    private val outbox: OutboxPostWriter,
    private val broker: MessageBroker,
) {
    /** 손으로 실험할 때 브로커를 끄고 켠다. 예: POST /experiments/events/broker?down=true */
    @PostMapping("/broker")
    fun setBroker(@RequestParam down: Boolean): Map<String, Any> {
        broker.down = down
        return brokerState()
    }

    @GetMapping("/broker")
    fun brokerState(): Map<String, Any> = mapOf("down" to broker.down, "received" to broker.received.size)

    @PostMapping("/before-commit")
    @ResponseStatus(HttpStatus.CREATED)
    fun beforeCommit(@Valid @RequestBody req: CreatePostRequest, @RequestParam(defaultValue = "false") failAtEnd: Boolean) =
        PostResponse.from(beforeCommit.write(req.authorId, req.regionId, req.content, failAtEnd))

    @PostMapping("/after-commit")
    @ResponseStatus(HttpStatus.CREATED)
    fun afterCommit(@Valid @RequestBody req: CreatePostRequest, @RequestParam(defaultValue = "false") failAtEnd: Boolean) =
        PostResponse.from(afterCommit.write(req.authorId, req.regionId, req.content, failAtEnd))

    @PostMapping("/outbox")
    @ResponseStatus(HttpStatus.CREATED)
    fun outbox(@Valid @RequestBody req: CreatePostRequest, @RequestParam(defaultValue = "false") failAtEnd: Boolean) =
        PostResponse.from(outbox.write(req.authorId, req.regionId, req.content, failAtEnd))

    @ExceptionHandler(BrokerUnavailableException::class)
    @ResponseStatus(HttpStatus.SERVICE_UNAVAILABLE)
    fun brokerDown(e: BrokerUnavailableException) = mapOf("error" to e.message)

    @ExceptionHandler(LaterStepFailedException::class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    fun laterStepFailed(e: LaterStepFailedException) = mapOf("error" to e.message)
}
