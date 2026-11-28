-- 글과 같은 트랜잭션에서 함께 쓰는 "보낼 메시지" 표. 릴레이가 읽어 브로커로 보낸다.
create table outbox_event
(
    id             bigint generated always as identity primary key,
    event_id       uuid         not null unique, -- 받는 쪽이 중복을 거르는 키
    aggregate_type varchar(50)  not null,
    aggregate_id   bigint       not null,
    event_type     varchar(100) not null,
    payload        jsonb        not null,
    created_at     timestamptz  not null,
    published_at   timestamptz,                  -- null 이면 아직 못 보냄
    attempts       int          not null default 0,
    last_error     varchar(500)
);

-- 릴레이는 "아직 안 보낸 것"만 오래된 순으로 읽는다
create index outbox_event_unpublished_idx on outbox_event (id) where published_at is null;
