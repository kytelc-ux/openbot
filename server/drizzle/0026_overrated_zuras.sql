CREATE TYPE "public"."cloud_team_run_status" AS ENUM('queued', 'running', 'completed', 'needs_review', 'failed', 'budget_exceeded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."cloud_team_step_role" AS ENUM('planner', 'worker', 'reviewer');--> statement-breakpoint
CREATE TABLE "cloud_team_materials" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cloud_team_material_title_length" CHECK (char_length("cloud_team_materials"."title") between 1 and 120),
	CONSTRAINT "cloud_team_material_content_length" CHECK (char_length("cloud_team_materials"."content") between 1 and 30000),
	CONSTRAINT "cloud_team_material_source_length" CHECK (char_length("cloud_team_materials"."source") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "cloud_team_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"content" text NOT NULL,
	"source_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cloud_team_memory_content_length" CHECK (char_length("cloud_team_memories"."content") between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "cloud_team_run_materials" (
	"run_id" text NOT NULL,
	"material_id" text NOT NULL,
	CONSTRAINT "cloud_team_run_materials_run_id_material_id_pk" PRIMARY KEY("run_id","material_id")
);
--> statement-breakpoint
CREATE TABLE "cloud_team_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"objective" text NOT NULL,
	"status" "cloud_team_run_status" DEFAULT 'queued' NOT NULL,
	"result" text,
	"error" text,
	"spent_micros" bigint DEFAULT 0 NOT NULL,
	"reserved_micros" bigint DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"claimed_by" text,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cloud_team_run_objective_length" CHECK (char_length("cloud_team_runs"."objective") between 1 and 8000),
	CONSTRAINT "cloud_team_run_usage_nonnegative" CHECK ("cloud_team_runs"."spent_micros" >= 0 and "cloud_team_runs"."reserved_micros" >= 0 and "cloud_team_runs"."input_tokens" >= 0 and "cloud_team_runs"."output_tokens" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cloud_team_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"role" "cloud_team_step_role" NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"reserved_micros" bigint DEFAULT 0 NOT NULL,
	"output" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "cloud_team_step_usage_nonnegative" CHECK ("cloud_team_steps"."ordinal" >= 0 and "cloud_team_steps"."input_tokens" >= 0 and "cloud_team_steps"."output_tokens" >= 0 and "cloud_team_steps"."cost_micros" >= 0 and "cloud_team_steps"."reserved_micros" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cloud_team_materials" ADD CONSTRAINT "cloud_team_materials_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_team_memories" ADD CONSTRAINT "cloud_team_memories_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_team_memories" ADD CONSTRAINT "cloud_team_memories_source_run_id_cloud_team_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."cloud_team_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_team_run_materials" ADD CONSTRAINT "cloud_team_run_materials_run_id_cloud_team_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."cloud_team_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_team_run_materials" ADD CONSTRAINT "cloud_team_run_materials_material_id_cloud_team_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."cloud_team_materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_team_runs" ADD CONSTRAINT "cloud_team_runs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_team_steps" ADD CONSTRAINT "cloud_team_steps_run_id_cloud_team_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."cloud_team_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cloud_team_materials_owner_created_idx" ON "cloud_team_materials" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "cloud_team_memories_owner_created_idx" ON "cloud_team_memories" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "cloud_team_memories_source_run_idx" ON "cloud_team_memories" USING btree ("source_run_id");--> statement-breakpoint
CREATE INDEX "cloud_team_run_materials_run_idx" ON "cloud_team_run_materials" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "cloud_team_run_materials_material_idx" ON "cloud_team_run_materials" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "cloud_team_runs_owner_created_idx" ON "cloud_team_runs" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "cloud_team_runs_claimable_idx" ON "cloud_team_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cloud_team_steps_run_ordinal_idx" ON "cloud_team_steps" USING btree ("run_id","ordinal");