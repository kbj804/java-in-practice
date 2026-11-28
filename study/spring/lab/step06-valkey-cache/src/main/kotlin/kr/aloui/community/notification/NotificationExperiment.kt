package kr.aloui.community.notification

import com.rabbitmq.client.Channel
import org.slf4j.LoggerFactory
import org.springframework.amqp.core.Queue
import org.springframework.amqp.core.QueueBuilder
import org.springframework.amqp.rabbit.annotation.RabbitListener
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.stereotype.Component
import tools.jackson.databind.json.JsonMapper
import java.time.Clock
import java.util.concurrent.atomic.AtomicInteger
import org.springframework.amqp.core.Message as AmqpMessage

// 실험 ③: 받는 쪽 설계에서 한 줄씩 빼 보면 무엇이 깨지나.
// 실험용 큐는 exchange 에 묶지 않는다. 테스트가 기본 exchange("")로 큐 이름을 지정해 직접 넣는다.

/** 가: inbox 없이 받으면 바로 이웃 모두에게 보낸다. tag 도 없다. */
const val EXPERIMENT_NAIVE_QUEUE = "experiment.naive"

/** 나: inbox 는 있지만 다 보낸 뒤에 ack 하고, 스케줄러가 없다. */
const val EXPERIMENT_LATE_ACK_QUEUE = "experiment.late-ack"

@Configuration
class ExperimentQueues {
    @Bean
    fun naiveQueue(): Queue = QueueBuilder.durable(EXPERIMENT_NAIVE_QUEUE).build()

    @Bean
    fun lateAckQueue(): Queue = QueueBuilder.durable(EXPERIMENT_LATE_ACK_QUEUE).build()
}

@Component
class NaiveNotificationListener(
    private val deliveries: NotificationDeliveryRepository,
    private val push: PushSender,
    private val jsonMapper: JsonMapper,
) {
    val handled = AtomicInteger()

    // 기본 ackMode(AUTO): 이 메서드가 정상으로 끝나면 ack. 같은 메시지가 두 번 오면 두 번 다 보낸다.
    @RabbitListener(queues = [EXPERIMENT_NAIVE_QUEUE])
    fun onMessage(message: AmqpMessage) {
        val incoming = message.toPostCreated(jsonMapper)
        for (userId in deliveries.memberIds(incoming.payload.regionId)) {
            push.send(userId, "동네에 새 글이 올라왔어요 (#${incoming.payload.postId})", tag = null)
        }
        handled.incrementAndGet()
    }
}

@Component
class LateAckNotificationListener(
    private val deliveries: NotificationDeliveryRepository,
    private val dispatcher: NotificationDispatcher,
    private val jsonMapper: JsonMapper,
    private val clock: Clock,
) {
    private val log = LoggerFactory.getLogger(javaClass)
    val handled = AtomicInteger()

    @RabbitListener(queues = [EXPERIMENT_LATE_ACK_QUEUE], ackMode = "MANUAL")
    fun onMessage(message: AmqpMessage, channel: Channel) {
        val deliveryTag = message.messageProperties.deliveryTag
        val incoming = message.toPostCreated(jsonMapper)
        try {
            deliveries.acceptForRegion(incoming.eventId, incoming.payload.postId, incoming.payload.regionId, clock.instant())
            dispatcher.dispatch()
            channel.basicAck(deliveryTag, false) // 다 보낸 뒤에야 ack
        } catch (t: Throwable) {
            // 서버가 죽으면 연결이 끊겨 RabbitMQ 가 메시지를 다시 준다. 여기서는 nack(requeue)로 같은 일을 흉내 낸다.
            log.warn("event {}: 보내다 멈춤 ({}). 메시지를 큐로 돌려보낸다", incoming.eventId, t.message)
            channel.basicNack(deliveryTag, false, true)
        } finally {
            handled.incrementAndGet()
        }
    }
}
