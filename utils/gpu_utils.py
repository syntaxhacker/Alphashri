import numpy as np
import torch

def to_gpu(data: np.ndarray) -> torch.Tensor:
    """Move numpy array to GPU"""
    return torch.from_numpy(data).float().cuda()

def to_cpu(data: torch.Tensor) -> np.ndarray:
    """Move tensor from GPU to CPU as numpy array"""
    return data.cpu().numpy() 