import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { DesignSystem } from "../../lib/design-system-types";
import { subscribeLive } from "../live";

const KEY = ["design-systems"];

async function fetchAll(): Promise<DesignSystem[]> {
	const res = await fetch("/api/design-systems");
	if (!res.ok) return [];
	const data = await res.json();
	return Array.isArray(data) ? data : [];
}

export function useDesignSystem(id = "default") {
	const queryClient = useQueryClient();
	const { data: systems = [], isLoading } = useQuery({
		queryKey: KEY,
		queryFn: fetchAll,
	});

	useEffect(() => {
		return subscribeLive("design-system", () => {
			queryClient.invalidateQueries({ queryKey: KEY });
		});
	}, [queryClient]);

	const active = systems.find((s) => s.id === id) ?? systems[0] ?? null;

	const extract = useMutation({
		mutationFn: async () => {
			const res = await fetch(
				`/api/design-systems/${encodeURIComponent(id)}/extract`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ from: "css" }),
				},
			);
			if (!res.ok) throw new Error("Extract failed");
			return res.json();
		},
		onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
	});

	const publish = useMutation({
		mutationFn: async () => {
			const res = await fetch(
				`/api/design-systems/${encodeURIComponent(active?.id ?? id)}/publish`,
				{ method: "POST" },
			);
			if (!res.ok) throw new Error("Publish failed");
			return res.json();
		},
		onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
	});

	const save = useMutation({
		mutationFn: async (fields: {
			title?: string;
			guidelines?: string;
			tokens?: DesignSystem["tokens"];
		}) => {
			const target = active?.id ?? id;
			const exists = Boolean(active);
			const res = await fetch(
				exists
					? `/api/design-systems/${encodeURIComponent(target)}`
					: "/api/design-systems",
				{
					method: exists ? "PUT" : "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ id: target, ...fields }),
				},
			);
			if (!res.ok) throw new Error("Save failed");
			return res.json();
		},
		onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
	});

	const addComment = useMutation({
		mutationFn: async (body: {
			kind?: string;
			target?: string;
			body: string;
		}) => {
			const res = await fetch(
				`/api/design-systems/${encodeURIComponent(active?.id ?? id)}/comments`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				},
			);
			if (!res.ok) throw new Error("Comment failed");
			return res.json();
		},
		onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
	});

	const resolveComment = useMutation({
		mutationFn: async (commentId: string) => {
			const res = await fetch(
				`/api/design-systems/${encodeURIComponent(active?.id ?? id)}/comments/${commentId}`,
				{
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ status: "resolved" }),
				},
			);
			if (!res.ok) throw new Error("Resolve failed");
			return res.json();
		},
		onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
	});

	const addComponent = useMutation({
		mutationFn: async (component: {
			id: string;
			label?: string;
			html: string;
			source?: string;
		}) => {
			const res = await fetch(
				`/api/design-systems/${encodeURIComponent(active?.id ?? id)}/components`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(component),
				},
			);
			if (!res.ok) throw new Error("Component failed");
			return res.json();
		},
		onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
	});

	return {
		systems,
		active,
		isLoading,
		extract,
		publish,
		save,
		addComment,
		resolveComment,
		addComponent,
	};
}
