import axios from 'axios';

/** ElMessageBox 的取消/关闭、axios 的主动取消都属于正常交互，不是错误 */
export function isCancel(error: unknown): boolean {
  return error === 'cancel' || error === 'close' || axios.isCancel(error);
}

/** 接口失败时 http 层已经弹过提示，这里只兜底 http 层之外的异常，避免同一个错误提示两次 */
export function reportError(error: unknown, fallback: string) {
  if (isCancel(error) || axios.isAxiosError(error)) return;
  ElMessage.error(fallback);
}

/**
 * 二次确认。ElMessageBox.confirm 在取消时会 reject，直接 await 会产生
 * 未处理的 rejection，这里统一转成 false。
 */
export async function confirmAction(message: string, title = '提示', type: 'warning' | 'info' = 'warning'): Promise<boolean> {
  try {
    await ElMessageBox.confirm(message, title, { type, confirmButtonText: '确定', cancelButtonText: '取消' });
    return true;
  } catch {
    return false;
  }
}

/** 包住一次异步动作：模板里 @click 直接调函数，抛出去只会变成未处理的 rejection */
export async function runAction(action: () => Promise<void>, fallback = '操作失败') {
  try {
    await action();
  } catch (error) {
    reportError(error, fallback);
  }
}
