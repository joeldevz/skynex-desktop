import React from 'react';
type MobileSidebarActions = { close: () => void };

const MobileSidebarActionsContext = React.createContext<MobileSidebarActions | null>(null);

export const MobileSidebarActionsProvider = MobileSidebarActionsContext.Provider;
