import { useEffect, useState } from "react";

export function AiRailStatusLine({ message }: { message: string | null }) {
	const [visible, setVisible] = useState(message);
	useEffect(() => {
		setVisible(message);
		if (!message) return;
		const timer = window.setTimeout(() => setVisible(null), 1600);
		return () => window.clearTimeout(timer);
	}, [message]);
	if (!visible) return null;
	return (
		<div className="ai-rail-status" role="status">
			{visible}
		</div>
	);
}
