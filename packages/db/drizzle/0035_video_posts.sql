CREATE TABLE "video_details" (
	"media_id" uuid PRIMARY KEY NOT NULL,
	"upload_id" text,
	"part_size" integer,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"fps" real,
	"original_sha256" text,
	"frames_scanned" integer,
	"match_frame_ms" integer,
	"scan_result" text,
	"poster_key" text,
	"rejection_reason" text,
	"failure_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_renditions" (
	"media_id" uuid NOT NULL,
	"height" integer NOT NULL,
	"width" integer NOT NULL,
	"bytes" integer NOT NULL,
	"bitrate_kbps" integer NOT NULL,
	CONSTRAINT "video_renditions_media_id_height_pk" PRIMARY KEY("media_id","height")
);
--> statement-breakpoint
ALTER TABLE "video_details" ADD CONSTRAINT "video_details_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_renditions" ADD CONSTRAINT "video_renditions_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;