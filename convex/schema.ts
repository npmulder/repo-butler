import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    workosId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_workos_id", ["workosId"])
    .index("by_email", ["email"]),
});
