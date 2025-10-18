/**
 * snapshot_api_service.js
 * 
 * 负责与后端 /api/snapshots/* 接口进行所有通信的服务模块
 */

const API_BASE_URL = '/poker/snapshots';

/**
 * 从后端获取所有快照的摘要列表
 * @returns {Promise<Array>} 快照摘要数组
 */
export async function getSnapshots() {
    const response = await fetch(API_BASE_URL);
    if (!response.ok) {
        throw new Error(`获取快照列表失败: ${response.statusText}`);
    }
    return response.json();
}

/**
 * 根据ID从后端获取单个快照的完整信息
 * @param {number} id 快照ID
 * @returns {Promise<Object>} 完整的快照对象
 */
export async function getSnapshotById(id) {
    const response = await fetch(`${API_BASE_URL}/${id}`);
    if (!response.ok) {
        throw new Error(`获取快照详情失败: ${response.statusText}`);
    }
    return response.json();
}

/**
 * 发送新的快照数据到后端进行创建
 * @param {Object} snapshotData 包含name, gameState, imageData, gtoSuggestions的对象
 * @returns {Promise<Object>} 后端返回的已保存的快照对象
 */
export async function createSnapshot(snapshotData) {
    const response = await fetch(API_BASE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(snapshotData),
    });
    if (!response.ok) {
        throw new Error(`创建快照失败: ${response.statusText}`);
    }
    return response.json();
}

/**
 * 更新指定ID快照的指定信息（如名称、备注等）
 * @param {number} id 快照ID
 * @param {Object} updateData 包含待更新字段的对象
 * @returns {Promise<Object>} 后端返回的已更新的快照对象
 */
export async function updateSnapshot(id, updateData) {
    const response = await fetch(`${API_BASE_URL}/${id}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
    });
    if (!response.ok) {
        throw new Error(`更新快照失败: ${response.statusText}`);
    }
    return response.json();
}

/**
 * 发送请求到后端删除指定ID的快照
 * @param {number} id 快照ID
 */
export async function deleteSnapshotById(id) {
    const response = await fetch(`${API_BASE_URL}/${id}`, {
        method: 'DELETE',
    });
    if (!response.ok) {
        throw new Error(`删除快照失败: ${response.statusText}`);
    }
    // DELETE请求通常返回204 No Content，没有响应体
}
