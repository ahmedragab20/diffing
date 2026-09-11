import type {
	KeyboardEvent as ReactKeyboardEvent,
	MutableRefObject,
	RefCallback,
	RefObject,
} from "react";
import { ImagePlus, Paperclip, Send, Square, X } from "lucide-react";
import type { AiImageAttachmentReference, AiReviewContext, AiSurface } from "../../lib/ai/types";
import { FileMentionDropdown } from "../components/FileMentionDropdown";
import type { UseFileMentionResult } from "../hooks/useFileMention";
import type { RunPhase } from "./useAiRun";
import { isRunBusy } from "./useAiRun";

export interface AiComposerProps {
	surface: AiSurface;
	context: AiReviewContext;
	prompt: string;
	onPromptChange: (value: string) => void;
	mention: UseFileMentionResult;
	textareaRef: RefCallback<HTMLTextAreaElement | null> | RefObject<HTMLTextAreaElement | null>;
	imageInputRef: RefObject<HTMLInputElement | null>;
	imageAttachments: AiImageAttachmentReference[];
	onRemoveImage: (url: string) => void;
	onUploadImages: (files: File[]) => void;
	onAttachPreview: () => void;
	imageCapable: boolean;
	imageUploading: boolean;
	previewAttaching: boolean;
	imageError: string | null;
	draggingImage: boolean;
	onDraggingImage: (dragging: boolean) => void;
	phase: RunPhase;
	conversationLoading: boolean;
	selectedModel: string;
	onSend: () => void;
	onStop: () => void;
}

export function AiComposer({
	surface,
	context,
	prompt,
	onPromptChange,
	mention,
	textareaRef,
	imageInputRef,
	imageAttachments,
	onRemoveImage,
	onUploadImages,
	onAttachPreview,
	imageCapable,
	imageUploading,
	previewAttaching,
	imageError,
	draggingImage,
	onDraggingImage,
	phase,
	conversationLoading,
	selectedModel,
	onSend,
	onStop,
}: AiComposerProps) {
	const isBusy = isRunBusy(phase);
	const setTextareaRef = (element: HTMLTextAreaElement | null) => {
		mention.setTextareaRef(element);
		if (typeof textareaRef === "function") textareaRef(element);
		else if (textareaRef)
			(textareaRef as MutableRefObject<HTMLTextAreaElement | null>).current =
				element;
	};

	const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
		if (mention.handleKeyDown(event)) return;
		if (
			event.key === "Enter" &&
			(event.metaKey || event.ctrlKey) &&
			(prompt.trim() || imageAttachments.length > 0) &&
			!isBusy
		) {
			event.preventDefault();
			onSend();
		}
	};

	return (
		<div
			className={`ai-rail-composer ${draggingImage ? "is-dragging-image" : ""}`}
			onDragEnter={(event) => {
				if (event.dataTransfer.types.includes("Files")) {
					event.preventDefault();
					onDraggingImage(true);
				}
			}}
			onDragOver={(event) => {
				if (event.dataTransfer.types.includes("Files")) event.preventDefault();
			}}
			onDragLeave={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null))
					onDraggingImage(false);
			}}
			onDrop={(event) => {
				event.preventDefault();
				onDraggingImage(false);
				void onUploadImages(Array.from(event.dataTransfer.files));
			}}
		>
			<input
				ref={imageInputRef}
				className="ai-image-input"
				type="file"
				accept="image/png,image/jpeg,image/webp,image/gif"
				multiple
				onChange={(event) => {
					void onUploadImages(Array.from(event.target.files ?? []));
					event.currentTarget.value = "";
				}}
				aria-label="Attach images"
			/>
			{imageAttachments.length > 0 && (
				<div className="ai-composer-images">
					{imageAttachments.map((image) => (
						<div className="ai-composer-image" key={image.url}>
							<img src={image.url} alt="" />
							<span title={image.name}>{image.name}</span>
							<button
								type="button"
								onClick={() => onRemoveImage(image.url)}
								aria-label={`Remove image ${image.name}`}
							>
								<X size={13} />
							</button>
						</div>
					))}
				</div>
			)}
			<div className="ai-composer-editor">
				<textarea
					ref={setTextareaRef}
					value={prompt}
					onChange={(event) => onPromptChange(event.target.value)}
					onPaste={(event) => {
						const files = Array.from(event.clipboardData.files).filter((file) =>
							file.type.startsWith("image/"),
						);
						if (files.length) {
							event.preventDefault();
							void onUploadImages(files);
						}
					}}
					onKeyDown={handleComposerKeyDown}
					placeholder="Ask about this review context… Type @ to attach files"
					aria-label="Ask AI"
				/>
				{mention.isOpen && (
					<FileMentionDropdown
						results={mention.results}
						focusedIndex={mention.focusedIndex}
						query={mention.query}
						cursorTop={mention.cursorTop}
						onSelect={mention.onSelect}
						onHover={mention.setFocusedIndex}
					/>
				)}
			</div>
			{imageError && (
				<div className="ai-image-error" role="alert">
					{imageError}
				</div>
			)}
			<div>
				<button
					type="button"
					className="ai-attach-image-btn"
					onClick={() => imageInputRef.current?.click()}
					disabled={!imageCapable || imageUploading || previewAttaching || isBusy}
					aria-label="Attach images"
					title={
						imageCapable
							? "Attach images"
							: "Selected model source does not support images"
					}
				>
					<ImagePlus size={15} />
					{imageUploading ? "Uploading…" : "Image"}
				</button>
				{surface === "mockup" && "mockupId" in context && (
					<button
						type="button"
						className="ai-attach-image-btn"
						onClick={() => void onAttachPreview()}
						disabled={!imageCapable || imageUploading || previewAttaching || isBusy}
						aria-label="Attach preview"
						title={
							imageCapable
								? "Capture this screen and attach it to the next message"
								: "Selected model source does not support images"
						}
					>
						<ImagePlus size={15} />
						{previewAttaching ? "Capturing…" : "Attach preview"}
					</button>
				)}
				<span className="ai-composer-hint">
					<Paperclip size={12} /> @ attach files · ⌘↵ send
				</span>
				<span />
				{isBusy ? (
					<button
						type="button"
						className="ai-stop-btn"
						onClick={() => void onStop()}
						disabled={phase === "stopping"}
						aria-label="Stop AI request"
					>
						<Square size={13} /> {phase === "stopping" ? "Stopping" : "Stop"}
					</button>
				) : (
					<button
						type="button"
						className="ai-send-btn"
						disabled={
							(!prompt.trim() && imageAttachments.length === 0) ||
							!selectedModel ||
							conversationLoading ||
							imageUploading ||
							(imageAttachments.length > 0 && !imageCapable)
						}
						onClick={() => onSend()}
					>
						<Send size={15} /> Send
					</button>
				)}
			</div>
		</div>
	);
}
