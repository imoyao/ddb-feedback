<script setup lang="ts">
// 数据库迁移闸门（cf-setup）期间的专用管理员登录页。
//
// 未迁移时，migrate-check 中间件会把普通页面重定向到 /setup，管理员无处登录，
// 导致 pending 状态的升级迁移永远卡在 REQUIRES_ADMIN（见 run.post.ts）。
// 本页位于中间件白名单内，可正常渲染并弹出全局 LoginModal；管理员登录成功后
// 自动跳回 /setup，由 /setup 的轮询以管理员身份调用 /api/_migrate/run 完成迁移。
const { isOpen } = useLoginModal()
const { data: session } = useAuthSession()

// 强制弹出全局登录弹窗（isOpen 是全局 useState，默认布局里的 LoginModal 会随之打开）。
isOpen.value = true

watch(
  () => session.value,
  (s) => {
    if (s?.user?.role === 'admin') {
      navigateTo('/setup')
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="min-h-screen grid place-items-center bg-background p-6">
    <div class="w-full max-w-sm space-y-3 text-center">
      <AppLogo :size="48" class="mx-auto" />
      <h1 class="font-heading text-xl">管理员登录以完成更新</h1>
      <p class="text-sm text-muted-foreground">
        系统有待执行的数据库迁移，需管理员登录确认。登录成功后将自动跳转继续。
      </p>
      <p
        v-if="session?.user && session.user.role !== 'admin'"
        class="text-sm text-destructive"
      >
        当前账号不是管理员，无法确认更新。
      </p>
    </div>
  </div>
</template>
