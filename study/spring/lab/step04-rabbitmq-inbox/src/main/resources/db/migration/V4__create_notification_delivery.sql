-- 동네 이웃 목록. 글이 올라오면 같은 동네 이웃에게 알림을 보낸다.
create table region_member
(
    region_id bigint not null,
    user_id   bigint not null,
    primary key (region_id, user_id)
);

-- 알림 워커의 inbox. 이웃 한 명에게 보낼 알림 한 건이 한 행이다.
--   pending    → 아직 아무도 안 가져감
--   processing → 어떤 워커가 claimed_at 에 가져가서 보내는 중 (리스가 지나면 다른 워커가 다시 가져갈 수 있음)
--   completed  → 보냄
create table notification_delivery
(
    id           bigint generated always as identity primary key,
    event_id     uuid        not null, -- RabbitMQ 메시지의 messageId (= outbox event_id)
    post_id      bigint      not null,
    user_id      bigint      not null,
    state        varchar(20) not null check (state in ('pending', 'processing', 'completed')),
    claimed_at   timestamptz,
    completed_at timestamptz,
    created_at   timestamptz not null,
    -- 같은 메시지가 두 번 와도, 두 워커가 동시에 받아도 이 사람에게 이 소식은 한 행만 생긴다
    constraint notification_delivery_event_user_uk unique (event_id, user_id)
);

-- 가져가기 쿼리는 끝나지 않은 행만 본다
create index notification_delivery_open_idx on notification_delivery (id) where state <> 'completed';
