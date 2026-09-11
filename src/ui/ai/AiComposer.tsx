import {
	useEffect,
	useMemo,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
	type MutableRefObject,
	type RefCallback,
	type RefObject,
} from "react";
import { ImagePlus, Send, Square, X } from "lucide-react";
import type { AiImageAttachmentReference, AiReviewContext, AiSurface } from "../../lib/ai/types";
import { FileMentionDropdown } from "../components/FileMentionDropdown";
import type { UseFileMentionResult } from "../hooks/useFileMention";
import type { RunPhase } from "./useAiRun";
import { isRunBusy } from "./useAiRun";
import { matchesAiShortcut } from "./aiShortcuts";
import { AiSlashPalette } from "./AiSlashPalette";
import type { RailQuickAction } from "./railHelpers";

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
	onAttachImage?: () => void;
	onClearComposer?: () => void;
	onUndoClear?: () => void;
	onInsertMentionTrigger?: () => void;
	slashItems?: RailQuickAction[];
	onSlashRun?: (item: RailQuickAction) => void;
}

function filterSlashItems(
	items: RailQuickAction[],
	query: string,
): RailQuickAction[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return items;
	return items.filter((item) =>
		`${item.label} ${item.action} ${item.hint}`.toLowerCase().includes(needle),
	);
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
	onAttachImage,
	onClearComposer,
	onUndoClear,
	onInsertMentionTrigger,
	slashItems = [],
	onSlashRun,
}: AiComposerProps) {
	const isBusy = isRunBusy(phase);
	const [slashDismissed, setSlashDismissed] = useState(false);
	const [slashIndex, setSlashIndex] = useState(0);
	const slashQuery =
		prompt.startsWith("/") && !prompt.includes("\n") ? prompt.slice(1) : null;
	const filteredSlash = useMemo(
		() =>
			slashQuery === null ? [] : filterSlashItems(slashItems, slashQuery),
		[slashItems, slashQuery],
	);
	const slashOpen =
		slashQuery !== null &&
		!slashDismissed &&
		!mention.isOpen &&
		filteredSlash.length > 0;

	useEffect(() => {
		if (!prompt.startsWith("/")) setSlashDismissed(false);
	}, [prompt]);

	useEffect(() => {
		setSlashIndex(0);
	}, [slashQuery]);

	useEffect(() => {
		if (slashIndex >= filteredSlash.length)
			setSlashIndex(Math.max(0, filteredSlash.length - 1));
	}, [filteredSlash.length, slashIndex]);

	const setTextareaRef = (element: HTMLTextAreaElement | null) => {
		mention.setTextareaRef(element);
		if (typeof textareaRef === "function") textareaRef(element);
		else if (textareaRef)
			(textareaRef as MutableRefObject<HTMLTextAreaElement | null>).current =
				element;
	};

	const pickSlash = (item: RailQuickAction) => {
		setSlashDismissed(true);
		if (item.needsInput) {
			onPromptChange("");
			return;
		}
		onSlashRun?.(item);
	};

	const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
		if (mention.handleKeyDown(event)) return;
		if (slashOpen) {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				event.stopPropagation();
				setSlashIndex((index) => (index + 1) % filteredSlash.length);
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				event.stopPropagation();
				setSlashIndex(
					(index) =>
						(index - 1 + filteredSlash.length) % filteredSlash.length,
				);
				return;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				const item = filteredSlash[slashIndex] ?? filteredSlash[0];
				if (item) {
					event.preventDefault();
					event.stopPropagation();
					pickSlash(item);
				}
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				setSlashDismissed(true);
				return;
			}
		}
		if (matchesAiShortcut(event, "attach-image") && onAttachImage) {
			event.preventDefault();
			event.stopPropagation();
			onAttachImage();
			return;
		}
		if (matchesAiShortcut(event, "clear-composer") && onClearComposer) {
			event.preventDefault();
			event.stopPropagation();
			onClearComposer();
			return;
		}
		if (
			(event.metaKey || event.ctrlKey) &&
			event.key.toLowerCase() === "z" &&
			!event.shiftKey &&
			!prompt &&
			imageAttachments.length === 0 &&
			onUndoClear
		) {
			event.preventDefault();
			event.stopPropagation();
			onUndoClear();
			return;
		}
		if (matchesAiShortcut(event, "insert-file-mention") && onInsertMentionTrigger) {
			event.preventDefault();
			event.stopPropagation();
			onInsertMentionTrigger();
			return;
		}
		if (event.key !== "Enter") return;
		if (event.shiftKey) return;
		if (isBusy) return;
		if (!prompt.trim() && imageAttachments.length === 0) return;
		event.preventDefault();
		event.stopPropagation();
		onSend();
	};

	const sendDisabled =
		(!prompt.trim() && imageAttachments.length === 0) ||
		!selectedModel ||
		conversationLoading ||
		imageUploading ||
		(imageAttachments.length > 0 && !imageCapable);
	const sendTitle = !selectedModel
		? "Connect a model to send"
		: conversationLoading
			? "Loading conversation"
			: imageUploading
				? "Wait for images to finish uploading"
				: imageAttachments.length > 0 && !imageCapable
					? "Selected model source does not support images"
					: undefined;
	const imageTitle = !imageCapable
		? "Selected model source does not support images"
		: imageUploading
			? "Wait for images to finish uploading"
			: "Attach images";

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
					placeholder="Ask about this review context… Type / for actions, @ to attach files"
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
				{slashOpen && (
					<AiSlashPalette
						items={filteredSlash}
						focusedIndex={slashIndex}
						query={slashQuery ?? ""}
						onSelect={pickSlash}
						onHover={setSlashIndex}
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
					title={imageTitle}
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
					↵ send · ⇧↵ newline · / actions · @ files
				</span>
				<span className="ai-composer-counter">
					{prompt.length > 2000 ? `${prompt.length}` : ""}
				</span>
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
						disabled={sendDisabled}
						title={sendDisabled ? sendTitle : undefined}
						onClick={() => onSend()}
					>
						<Send size={15} /> Send
					</button>
				)}
			</div>
		</div>
	);
}
