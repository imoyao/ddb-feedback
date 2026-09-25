import { eq, sql } from 'drizzle-orm'
import { helpCollection } from '#layers/feedlog/server/db/schemas'
import { createHelpCollectionSchema } from '#layers/feedlog/shared/schemas/help'

export default defineEventHandler(async (event) => {
  const { orgId } = await requireOrgPermission(event, { feedlog: ['moderate'] })
  const body = await readValidatedBody(event, createHelpCollectionSchema.parse)

  const db = useDB()

  const [max] = await db
    .select({ position: sql<number>`cast(coalesce(max(${helpCollection.position}), -1) as int)` })
    .from(helpCollection)
    .where(eq(helpCollection.orgId, orgId))

  const [created] = await db
    .insert(helpCollection)
    .values({
      orgId,
      name: body.name,
      description: body.description ?? null,
      icon: body.icon,
      visible: body.visible,
      position: (max?.position ?? -1) + 1,
    })
    .returning({
      id: helpCollection.id,
      name: helpCollection.name,
      description: helpCollection.description,
      icon: helpCollection.icon,
      visible: helpCollection.visible,
      position: helpCollection.position,
    })

  setResponseStatus(event, 201)
  return { ...created, articleCount: 0, articles: [] }
})
