<template>
  <el-result icon="warning" title="页面不存在" :sub-title="'地址 ' + route.fullPath + ' 没有对应的页面'">
    <template #extra>
      <el-button type="primary" @click="goHome">返回数据概览</el-button>
    </template>
  </el-result>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { runAction } from '../composables/async';

const route = useRoute();
const router = useRouter();

function goHome() {
  void runAction(async () => {
    await router.replace('/dashboard');
  }, '跳转失败');
}
</script>
