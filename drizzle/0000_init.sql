CREATE TYPE "public"."deleted_by" AS ENUM('host', 'uploader');--> statement-breakpoint
CREATE TYPE "public"."export_status" AS ENUM('queued', 'running', 'ready', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."photo_status" AS ENUM('reserved', 'uploaded', 'processing', 'pending', 'live', 'hidden', 'failed', 'duplicate', 'expired', 'deleted');--> statement-breakpoint
CREATE TABLE "albums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"photo_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"text" text NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text,
	"code" text NOT NULL,
	"tv_token" text NOT NULL,
	"name" text NOT NULL,
	"event_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"cover_key" text,
	"welcome" text DEFAULT '' NOT NULL,
	"accent" text DEFAULT '#8a4b3c' NOT NULL,
	"settings" jsonb DEFAULT '{"hearts":true,"comments":true,"guestDownloads":true,"approval":false,"defaultOrder":"newest","tv":{"seconds":7,"albumId":null,"showNames":true,"showQr":true,"showPin":false}}'::jsonb NOT NULL,
	"pin_hash" text,
	"pin_version" integer DEFAULT 0 NOT NULL,
	"pin_paused_until" timestamp with time zone,
	"tv_pin_encrypted" text,
	"frozen_at" timestamp with time zone,
	"max_photos" integer NOT NULL,
	"max_bytes" bigint NOT NULL,
	"used_photos" integer DEFAULT 0 NOT NULL,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "events_code_unique" UNIQUE("code"),
	CONSTRAINT "events_tv_token_unique" UNIQUE("tv_token")
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"status" "export_status" DEFAULT 'queued' NOT NULL,
	"options" jsonb NOT NULL,
	"photo_ids" uuid[] NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"size_bytes" bigint,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hashtags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"norm" text NOT NULL,
	"display" text NOT NULL,
	"suggested" boolean DEFAULT false NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "heartbeats" (
	"name" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hearts" (
	"photo_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hearts_photo_id_participant_id_pk" PRIMARY KEY("photo_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"token_hash" text,
	"user_id" text,
	"name" text DEFAULT '' NOT NULL,
	"pin_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_contributors" (
	"photo_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_contributors_photo_id_participant_id_pk" PRIMARY KEY("photo_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "photo_hashtags" (
	"photo_id" uuid NOT NULL,
	"hashtag_id" uuid NOT NULL,
	CONSTRAINT "photo_hashtags_photo_id_hashtag_id_pk" PRIMARY KEY("photo_id","hashtag_id")
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"album_id" uuid,
	"client_id" uuid NOT NULL,
	"status" "photo_status" DEFAULT 'reserved' NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text,
	"mime" text,
	"ext" text,
	"width" integer,
	"height" integer,
	"thumbhash" text,
	"taken_at" timestamp with time zone,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"featured" boolean DEFAULT false NOT NULL,
	"heart_count" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"deleted_by" "deleted_by",
	"duplicate_of" uuid,
	"download_ready" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "albums" ADD CONSTRAINT "albums_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hashtags" ADD CONSTRAINT "hashtags_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hearts" ADD CONSTRAINT "hearts_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hearts" ADD CONSTRAINT "hearts_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_contributors" ADD CONSTRAINT "photo_contributors_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_contributors" ADD CONSTRAINT "photo_contributors_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_hashtags" ADD CONSTRAINT "photo_hashtags_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_hashtags" ADD CONSTRAINT "photo_hashtags_hashtag_id_hashtags_id_fk" FOREIGN KEY ("hashtag_id") REFERENCES "public"."hashtags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_duplicate_of_photos_id_fk" FOREIGN KEY ("duplicate_of") REFERENCES "public"."photos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "albums_event_idx" ON "albums" USING btree ("event_id","position");--> statement-breakpoint
CREATE INDEX "comments_photo_idx" ON "comments" USING btree ("photo_id","created_at","id");--> statement-breakpoint
CREATE INDEX "events_owner_idx" ON "events" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "events_deleted_idx" ON "events" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "exports_event_idx" ON "exports" USING btree ("event_id","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exports_one_running" ON "exports" USING btree ("event_id") WHERE "exports"."status" in ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "hashtags_norm_unique" ON "hashtags" USING btree ("event_id","norm");--> statement-breakpoint
CREATE UNIQUE INDEX "participants_token_unique" ON "participants" USING btree ("event_id","token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "participants_user_unique" ON "participants" USING btree ("event_id","user_id");--> statement-breakpoint
CREATE INDEX "contributors_participant_idx" ON "photo_contributors" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "photo_hashtags_tag_idx" ON "photo_hashtags" USING btree ("hashtag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "photos_client_unique" ON "photos" USING btree ("event_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "photos_hash_unique" ON "photos" USING btree ("event_id","sha256") WHERE "photos"."status" not in ('failed', 'expired', 'deleted', 'duplicate');--> statement-breakpoint
CREATE INDEX "photos_published_idx" ON "photos" USING btree ("event_id","status","published_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "photos_taken_idx" ON "photos" USING btree ("event_id","status","taken_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "photos_hearts_idx" ON "photos" USING btree ("event_id","status","heart_count" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "photos_uploaded_idx" ON "photos" USING btree ("event_id","status","uploaded_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "photos_participant_idx" ON "photos" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "photos_reserved_idx" ON "photos" USING btree ("status","reserved_at");--> statement-breakpoint
CREATE INDEX "rate_limits_window_idx" ON "rate_limits" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");