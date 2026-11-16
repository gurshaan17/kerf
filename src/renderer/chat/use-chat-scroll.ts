import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function useChatScroll(key: string, updates: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const position = useRef(0);
  const [showJump, setShowJump] = useState(false);
  const jump = () => {
    following.current = true;
    setShowJump(false);
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  };
  const reconcile = () => {
    const element = scrollRef.current;
    if (element)
      element.scrollTop = following.current
        ? element.scrollHeight
        : position.current;
  };
  useLayoutEffect(() => {
    jump();
  }, [key]);
  useLayoutEffect(reconcile, [updates]);
  useEffect(() => {
    const observer = new ResizeObserver(reconcile);
    if (contentRef.current) observer.observe(contentRef.current);
    if (scrollRef.current) observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, []);
  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    position.current = element.scrollTop;
    following.current =
      element.scrollHeight - element.clientHeight - element.scrollTop <= 64;
    setShowJump(!following.current);
  };
  return { scrollRef, contentRef, onScroll, showJump, jump };
}
