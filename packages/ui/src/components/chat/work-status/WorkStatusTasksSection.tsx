import React from 'react';
import { SkynexTasksContent } from '@/components/tasks/SkynexTasksPanel';
import { useReportWorkStatusPresence } from './presenceContext';

export const WorkStatusTasksSection: React.FC<{ directory: string | null }> = ({ directory }) => {
  useReportWorkStatusPresence('tasks', Boolean(directory));
  if (!directory) return null;
  return <SkynexTasksContent key={directory} directory={directory} collapsible />;
};
