/**
 * FileTransferService — 文件传输基础层
 * 负责文件读取、类型校验、大小限制检查
 * @author weibin
 */

import * as fs from 'fs'
import * as path from 'path'

// ─── 常量定义 ───────────────────────────────────────────────────────────────

/** 各平台文件大小上限（字节） */
export const FILE_SIZE_LIMITS = {
  telegram: {
    photo:    10 * 1024 * 1024,  // 10 MB（sendPhoto 限制）
    document: 50 * 1024 * 1024,  // 50 MB（sendDocument 限制）
  },
  feishu: {
    image: 10 * 1024 * 1024,  // 10 MB（飞书图片上传限制）
    file:  30 * 1024 * 1024,  // 30 MB（飞书文件上传限制）
  },
}

/** 允许发送的文件扩展名（防止发送危险文件） */
export const SEND_ALLOWED_EXTS = new Set([
  // 文档
  '.txt', '.md', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // 数据
  '.json', '.csv', '.xml', '.yaml', '.yml', '.toml',
  // 代码（查看用）
  '.ts', '.js', '.py', '.go', '.java', '.rs', '.sh', '.sql',
  // 图片
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
  // 压缩 / 日志
  '.zip', '.tar', '.gz', '.log',
])

/** 图片扩展名（走 sendPhoto / image 消息，其余走 sendDocument / file 消息） */
export const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
])

// ─── 类型定义 ───────────────────────────────────────────────────────────────

/** 经过校验的、可直接传给 Bot API 的文件对象 */
export interface PreparedFile {
  buffer:    Buffer
  filename:  string
  mimeType:  string
  isImage:   boolean
  sizeBytes: number
}

// ─── 辅助函数 ───────────────────────────────────────────────────────────────

/**
 * 根据扩展名推断 MIME 类型（无需依赖 mime 包）
 * 覆盖常用格式，未知类型降级到 application/octet-stream
 */
function guessMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.txt': 'text/plain',      '.md': 'text/markdown',
    '.html': 'text/html',      '.css': 'text/css',
    '.js': 'text/javascript',  '.ts': 'text/typescript',
    '.py': 'text/x-python',    '.sh': 'text/x-shellscript',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.yaml': 'application/x-yaml', '.yml': 'application/x-yaml',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.csv': 'text/csv',
    '.log': 'text/plain',
    '.sql': 'application/sql',
  }
  return mimeMap[ext] ?? 'application/octet-stream'
}

/**
 * 清理文件名，防止路径注入攻击
 * - 移除路径分隔符
 * - 替换特殊字符
 * - 防止隐藏文件（.开头）绕过
 */
export function sanitizeFilename(name: string): string {
  return path.basename(name)       // 只取文件名部分，去掉所有目录前缀
    .replace(/[/\\:*?"<>|]/g, '_') // 替换文件系统非法字符
    .replace(/^\.+/, '_')          // 防止 .env、../ 等隐藏/穿越文件名
    .substring(0, 200)             // 限制文件名长度
    || 'file'                      // 兜底：空文件名改为 'file'
}

// ─── 主类 ───────────────────────────────────────────────────────────────────

/**
 * 文件传输服务
 * 所有发送前都必须经过 prepareFile + validatePlatformLimit 两道校验
 */
export class FileTransferService {

  /**
   * 从磁盘路径读取并校验文件，返回标准化的 PreparedFile
   * @throws 扩展名不允许、文件不存在时抛出错误
   */
  async prepareFile(filePath: string): Promise<PreparedFile> {
    const absPath = path.resolve(filePath)

    // 安全检查：文件必须存在
    if (!fs.existsSync(absPath)) {
      throw new Error(`文件不存在：${absPath}`)
    }

    const filename = sanitizeFilename(path.basename(absPath))
    const ext = path.extname(filename).toLowerCase()

    // 扩展名白名单校验
    if (!SEND_ALLOWED_EXTS.has(ext)) {
      throw new Error(
        `不支持发送 ${ext} 类型的文件。\n` +
        `允许的类型：文档(.md/.txt/.pdf/.docx)、数据(.json/.csv)、图片(.png/.jpg)、压缩(.zip)等`
      )
    }

    const buffer   = await fs.promises.readFile(absPath)
    const mimeType = guessMimeType(filename)
    const isImage  = IMAGE_EXTS.has(ext)

    return { buffer, filename, mimeType, isImage, sizeBytes: buffer.length }
  }

  /**
   * 从内存 Buffer 构建 PreparedFile（AI 生成内容直接传输，无需写磁盘）
   * @throws 扩展名不允许时抛出错误
   */
  prepareFromBuffer(buffer: Buffer, filename: string): PreparedFile {
    const safeFilename = sanitizeFilename(filename)
    const ext = path.extname(safeFilename).toLowerCase()

    if (!SEND_ALLOWED_EXTS.has(ext)) {
      throw new Error(`不支持发送 ${ext} 类型的文件`)
    }

    return {
      buffer,
      filename:  safeFilename,
      mimeType:  guessMimeType(safeFilename),
      isImage:   IMAGE_EXTS.has(ext),
      sizeBytes: buffer.length,
    }
  }

  /**
   * 校验文件是否符合目标平台的大小限制
   * @throws 超出限制时抛出带具体数值的错误
   */
  validatePlatformLimit(file: PreparedFile, platform: 'telegram' | 'feishu'): void {
    const limitBytes = platform === 'telegram'
      ? (file.isImage ? FILE_SIZE_LIMITS.telegram.photo    : FILE_SIZE_LIMITS.telegram.document)
      : (file.isImage ? FILE_SIZE_LIMITS.feishu.image      : FILE_SIZE_LIMITS.feishu.file)

    if (file.sizeBytes > limitBytes) {
      const limitMB  = (limitBytes    / 1024 / 1024).toFixed(0)
      const actualMB = (file.sizeBytes / 1024 / 1024).toFixed(1)
      const platform_cn = platform === 'telegram' ? 'Telegram' : '飞书'
      throw new Error(
        `文件 ${file.filename}（${actualMB} MB）超过 ${platform_cn} ${limitMB} MB 限制`
      )
    }
  }

  /** 根据文件名推断飞书 file_type 枚举值 */
  static guessFeishuFileType(filename: string): string {
    const ext = path.extname(filename).toLowerCase()
    const typeMap: Record<string, string> = {
      '.pdf': 'pdf',
      '.doc': 'doc', '.docx': 'doc',
      '.xls': 'xls', '.xlsx': 'xls',
      '.ppt': 'ppt', '.pptx': 'ppt',
      '.zip': 'zip', '.tar': 'zip', '.gz': 'zip',
      '.mp4': 'mp4', '.mov': 'mp4',
    }
    return typeMap[ext] ?? 'stream'  // 'stream' 是飞书通用文件类型
  }

  /** 格式化文件大小为人类可读字符串 */
  static formatSize(bytes: number): string {
    if (bytes < 1024)           return `${bytes} B`
    if (bytes < 1024 * 1024)    return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }
}

/** 全局单例（供 fileTools.ts 工具使用，避免重复实例化） */
export const fileTransferService = new FileTransferService()
