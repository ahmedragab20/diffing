import type { MutableRefObject, RefObject } from "react";
import type { AiAssistantRailHandle } from "./AiAssistantRail";

const COMPOSER_SELECTOR = '.ai-assistant-rail textarea[aria-label="Ask AI"]';

function activeElement(): HTMLElement | null {
	return document.activeElement instanceof HTMLElement
		? document.activeElement
		: null;
}

export function rememberAiRailFocus(
	previousFocusRef: MutableRefObject<HTMLElement | null>,
): void {
	previousFocusRef.current = activeElement();
}

export function restoreAiRailFocus(
	previousFocusRef: MutableRefObject<HTMLElement | null>,
): void {
	const previous = previousFocusRef.current;
	previousFocusRef.current = null;
	previous?.focus?.();
}

export function toggleAskAiRail(args: {
	open: boolean;
	setOpen: (open: boolean) => void;
	railRef: RefObject<AiAssistantRailHandle | null>;
	previousFocusRef: MutableRefObject<HTMLElement | null>;
}): void {
	const composer = document.querySelector<HTMLTextAreaElement>(COMPOSER_SELECTOR);
	if (args.open) {
		if (composer && document.activeElement === composer) {
			args.setOpen(false);
			restoreAiRailFocus(args.previousFocusRef);
			return;
		}
		args.railRef.current?.focusComposer();
		composer?.focus();
		return;
	}
	rememberAiRailFocus(args.previousFocusRef);
	args.setOpen(true);
	requestAnimationFrame(() => args.railRef.current?.focusComposer());
}

export function openAskAiNewConversation(args: {
	setOpen: (open: boolean) => void;
	railRef: RefObject<AiAssistantRailHandle | null>;
	previousFocusRef: MutableRefObject<HTMLElement | null>;
}): void {
	rememberAiRailFocus(args.previousFocusRef);
	args.setOpen(true);
	requestAnimationFrame(() => {
		args.railRef.current?.newConversation();
		args.railRef.current?.focusComposer();
	});
}

export function askAboutActiveFile(args: {
	filePath: string | null | undefined;
	setOpen: (open: boolean) => void;
	railRef: RefObject<AiAssistantRailHandle | null>;
	previousFocusRef: MutableRefObject<HTMLElement | null>;
}): void {
	rememberAiRailFocus(args.previousFocusRef);
	args.setOpen(true);
	requestAnimationFrame(() => {
		if (args.filePath) args.railRef.current?.insertMention(args.filePath);
		args.railRef.current?.focusComposer();
	});
}
