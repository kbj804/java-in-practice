package kr.aloui.community.message

import org.springframework.amqp.core.BindingBuilder
import org.springframework.amqp.core.MessageBuilder
import org.springframework.amqp.core.MessageDeliveryMode
import org.springframework.amqp.core.MessageProperties
import org.springframework.amqp.core.Queue
import org.springframework.amqp.core.QueueBuilder
import org.springframework.amqp.core.TopicExchange
import org.springframework.amqp.rabbit.core.RabbitTemplate
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.stereotype.Component

/** 브로커로 보내는 메시지. eventId 는 받는 쪽이 같은 메시지를 두 번 처리하지 않게 거르는 키다. */
data class Message(
    val eventId: String,
    val type: String,
    val payload: String,
)

/** 커뮤니티 내부 도메인 이벤트가 모이는 exchange. 라우팅 키는 이벤트 종류(PostCreated 등)다. */
const val EVENTS_EXCHANGE = "community.events"

/** 알림 워커가 읽는 큐. PostCreated 만 받는다. */
const val NOTIFICATION_QUEUE = "notification.post-created"

@Configuration
class RabbitTopology {
    // 앱이 뜰 때 RabbitAdmin 이 exchange·큐·바인딩이 없으면 만든다.
    @Bean
    fun eventsExchange(): TopicExchange = TopicExchange(EVENTS_EXCHANGE)

    // durable: 브로커가 재시작돼도 큐가 남는다. 메시지도 남기려면 보낼 때 PERSISTENT 로 보낸다.
    @Bean
    fun notificationQueue(): Queue = QueueBuilder.durable(NOTIFICATION_QUEUE).build()

    @Bean
    fun notificationBinding(notificationQueue: Queue, eventsExchange: TopicExchange) =
        BindingBuilder.bind(notificationQueue).to(eventsExchange).with("PostCreated")
}

/**
 * step03 의 메모리 대역(MessageBroker)을 RabbitMQ 로 바꾼 것.
 *
 * publish 가 정상으로 끝나면 "브로커가 받아서 디스크에 적었다"는 확인(publisher confirm)까지 받은 것이다.
 * 확인 없이 돌아오면 OutboxRelay 가 published_at 을 찍은 뒤 브로커 쪽에서 메시지가 사라져도 모른다.
 */
@Component
class EventPublisher(private val rabbit: RabbitTemplate) {

    fun publish(message: Message) {
        val amqp = MessageBuilder.withBody(message.payload.toByteArray())
            .setMessageId(message.eventId) // 받는 쪽은 이 값으로 중복을 거른다
            .setType(message.type)
            .setContentType(MessageProperties.CONTENT_TYPE_JSON)
            .setDeliveryMode(MessageDeliveryMode.PERSISTENT)
            .build()
        // invoke: 같은 채널에서 보내고, 그 채널로 확인을 기다린다 (spring.rabbitmq.publisher-confirm-type=simple)
        rabbit.invoke { ops ->
            ops.send(EVENTS_EXCHANGE, message.type, amqp)
            ops.waitForConfirmsOrDie(5_000)
        }
    }
}
