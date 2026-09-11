import { useEffect, useState } from "react";

export function AiRailStatusLine({
	message,
	nonce = 0,
}: {
	message: string | null;
	nonce?: number;
}) {
	const [visible, setVisible] = useState(message);
	useEffect(() => {
		setVisible(message);
		if (!message) return;
		const timer = window.setTimeout(() => setVisible(null), 1600);
		return () => window.clearTimeout(timer);
	}, [message, nonce]);
	if (!visible) return null;
	return (
		<div className="ai-rail-status" role="status">
			{visible}
		</div>
	);
}
