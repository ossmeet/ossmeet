import { useState, useEffect } from "react";
import { isIOS } from "@/lib/platform";

/**
 * Hook to track iOS keyboard offset and adjust layout accordingly.
 * 
 * On iOS, when the keyboard appears, it pushes up the visual viewport
 * without resizing the layout viewport. This causes input fields to be
 * covered by the keyboard. This hook tracks the offset and returns it
 * so you can adjust your UI accordingly.
 * 
 * @returns keyboardOffset - The height of the keyboard in pixels (0 when hidden)
 * 
 * @example
 * ```tsx
 * function ChatInput() {
 *   const keyboardOffset = useIOSKeyboard();
 *   
 *   return (
 *     <div
 *       style={{
 *         paddingBottom: keyboardOffset > 0 ? `${keyboardOffset}px` : undefined
 *       }}
 *     >
 *       <input type="text" />
 *     </div>
 *   );
 * }
 * ```
 */
export function useIOSKeyboard(): number {
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  useEffect(() => {
    // Only run on iOS devices
    if (!isIOS()) return;

    const vv = window.visualViewport;
    if (!vv) return;

    const onResize = () => {
      // When keyboard appears, visualViewport.height decreases
      // The difference between window.innerHeight and vv.height is the keyboard height
      const offset = window.innerHeight - vv.height;
      setKeyboardOffset(Math.max(0, offset));
    };

    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);

    // Call once to get initial state
    onResize();

    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
    };
  }, []);

  return keyboardOffset;
}
