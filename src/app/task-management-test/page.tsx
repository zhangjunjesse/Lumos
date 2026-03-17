'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface Task {
  id: string;
  summary: string;
  status: string;
  progress?: number;
  createdAt: string;
}

export default function TaskManagementTestPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/task-management/tasks');
      const data = await response.json();
      setTasks(data.tasks || []);
    } catch (error) {
      console.error('Failed to load tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTaskDetail = async (taskId: string) => {
    try {
      const response = await fetch(`/api/task-management/tasks/${taskId}`);
      const data = await response.json();
      setSelectedTask(data.task);
    } catch (error) {
      console.error('Failed to load task detail:', error);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-slate-500/10 text-slate-700';
      case 'running': return 'bg-blue-500/10 text-blue-700';
      case 'completed': return 'bg-emerald-500/10 text-emerald-700';
      case 'failed': return 'bg-red-500/10 text-red-700';
      case 'cancelled': return 'bg-slate-500/10 text-slate-700';
      default: return 'bg-slate-500/10 text-slate-700';
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Task Management 测试</h1>
        <Button onClick={loadTasks} disabled={loading}>
          {loading ? '加载中...' : '刷新任务列表'}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>测试说明</CardTitle>
          <CardDescription>
            1. 打开 Main Agent 对话页面<br/>
            2. 输入复杂任务请求（如："帮我实现一个完整的用户管理系统"）<br/>
            3. Main Agent 会通过 MCP 工具创建任务<br/>
            4. 回到此页面刷新查看任务列表
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>任务列表 ({tasks.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无任务</p>
            ) : (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className="p-3 border rounded-lg cursor-pointer hover:bg-muted/50"
                  onClick={() => loadTaskDetail(task.id)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">{task.summary}</span>
                    <Badge className={getStatusColor(task.status)}>
                      {task.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ID: {task.id}
                  </div>
                  {task.progress !== undefined && (
                    <div className="text-xs text-muted-foreground">
                      进度: {task.progress}%
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>任务详情</CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedTask ? (
              <p className="text-sm text-muted-foreground">点击左侧任务查看详情</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">任务摘要</p>
                  <p className="text-sm">{selectedTask.summary}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">状态</p>
                  <Badge className={getStatusColor(selectedTask.status)}>
                    {selectedTask.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">需求列表</p>
                  <ul className="text-sm space-y-1">
                    {selectedTask.requirements?.map((req: string, i: number) => (
                      <li key={i}>• {req}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">创建时间</p>
                  <p className="text-sm">{new Date(selectedTask.createdAt).toLocaleString()}</p>
                </div>
                {selectedTask.startedAt && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">开始时间</p>
                    <p className="text-sm">{new Date(selectedTask.startedAt).toLocaleString()}</p>
                  </div>
                )}
                {selectedTask.completedAt && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">完成时间</p>
                    <p className="text-sm">{new Date(selectedTask.completedAt).toLocaleString()}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
