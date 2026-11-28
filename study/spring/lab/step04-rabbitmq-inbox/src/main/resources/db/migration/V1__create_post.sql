create table post (
    id         bigint generated always as identity primary key,
    author_id  bigint        not null,
    region_id  bigint        not null,
    content    varchar(2000) not null,
    created_at timestamptz   not null
);

create index post_region_created_idx on post (region_id, created_at desc);
