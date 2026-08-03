import heapq
from typing import List


def max_k_sum(nums1: List[int], nums2: List[int], k: int) -> List[int]:
    n = len(nums1)
    indices = list(range(n))
    indices.sort(key=lambda i: nums1[i])

    heap = []      # min-heap holding at most k largest nums2 values seen
    total = 0      # running sum of the heap contents
    ans = [0] * n

    def add_to_top_k(x: int) -> None:
        nonlocal total
        if len(heap) < k:
            heapq.heappush(heap, x)
            total += x
        elif x > heap[0]:
            total += x - heapq.heapreplace(heap, x)

    i = 0
    while i < n:
        # group together every index sharing the same nums1 value
        group = [indices[i]]
        while i + 1 < n and nums1[indices[i + 1]] == nums1[indices[i]]:
            i += 1
            group.append(indices[i])

        # answers for this group are based on heap state BEFORE adding them
        for idx in group:
            ans[idx] = total

        # now fold this group's nums2 values into the top-k structure
        for idx in group:
            add_to_top_k(nums2[idx])

        i += 1

    return ans


if __name__ == "__main__":
    nums1 = [4, 2, 1, 5, 3]
    nums2 = [10, 20, 30, 40, 50]
    k = 2
    print(max_k_sum(nums1, nums2, k))   # [80, 30, 0, 80, 50]
