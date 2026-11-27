# Browser annotations

The desktop browser pane owns the annotation composer and the active annotation run. The annotated page owns the selection, regions, and drawing marks. The existing chat attachment flow owns the resulting screenshot and comment after submission.

## Why the editor lives outside the page

The microphone and editable transcript use the same dictation service and settings as chat. The desktop pane requests the current mark's rectangle and viewport using a fixed script while annotation mode is open. The editor validates those numbers and uses them only to position the bubble within the webview's on-screen bounds. The page never receives audio or comment text. The pane accepts an annotation only after an explicit attach action for the current run and adds the renderer's comment to the validated result. Closing the panel, navigating, or switching chats discards that run. The existing iframe annotation flow retains its in-page text editor.
